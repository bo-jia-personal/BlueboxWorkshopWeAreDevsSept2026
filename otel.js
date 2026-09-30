const { context, trace } = require('@opentelemetry/api');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
const {
  LoggerProvider,
  SimpleLogRecordProcessor,
} = require('@opentelemetry/sdk-logs');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');

const loggerProvider = new LoggerProvider(
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? {
        processors: [new SimpleLogRecordProcessor(new OTLPLogExporter())],
      }
    : undefined,
);
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  logs.setGlobalLoggerProvider(loggerProvider);
}

const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
sdk.start();

const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
};
const severity = {
  log: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/** Writes to the original console and exports the same message to OTLP logs.
 * @param {'log'|'warn'|'error'} method Console method and OTLP severity.
 * @param {unknown[]} args Values passed to the console method.
 * @returns {object|undefined} Emitted log record, or undefined when export is disabled.
 */
function forwardConsoleRecord(method, args) {
  originalConsole[method](...args);
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const body = args.length === 1 ? args[0] : args.map(String).join(' ');
  return logs.getLogger('console').emit({
    body,
    severityNumber: severity[method],
    severityText: method.toUpperCase(),
    attributes: { 'log.type': 'console' },
    context: context.active(),
    timestamp: Date.now(),
  });
}

/** Replaces one console method with its console-and-OTLP forwarding wrapper.
 * @param {'log'|'warn'|'error'} method Console method to wrap.
 * @returns {void}
 */
function installConsoleBridge(method) {
  console[method] = (...args) => forwardConsoleRecord(method, args);
}

Object.keys(originalConsole).forEach(installConsoleBridge);

/** Flushes and shuts down the trace and log SDK providers on process termination.
 * @returns {Promise<void>} Resolves when both providers have shut down.
 */
async function shutdownTelemetry() {
  await Promise.all([sdk.shutdown(), loggerProvider.shutdown()]);
}

process.once('SIGTERM', shutdownTelemetry);
