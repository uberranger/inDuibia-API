require('dotenv').config();

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const jwt = require('express-jwt');
const jwks = require('jwks-rsa');
const jwtScope = require('express-jwt-scope');

const cron = require('node-cron');
const cronParser = require('cron-parser');

const db = require('./util/db');
const logger = require('./util/logger');

const testRouter = require('./routes/test');
// const signatureRouter = require('./routes/signature');
const { router: documentRouter, sendAllReadyDocuments, verifyPendingTransactions } = require('./routes/document');
const { router: folderRouter }  = require('./routes/folder');
const { router: userRouter } = require('./routes/user');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1073741824 }
});

process.title = "inDubia API";

const logDivider = '========================================================================================================================';

cron.schedule(process.env.ETH_TXSEND_SCHEDULE, async () => {
  logger.info(logDivider);
  logger.info(`\t\t\t\t\tdaily transaction started, scheduled "${process.env.ETH_TXSEND_SCHEDULE}"`);
  logger.info(logDivider);

  try {
    await sendAllReadyDocuments();

    logger.info(logDivider);
    logger.info(`\t\t\tdaily transaction ended, next scheduled ${cronParser.parseExpression(process.env.ETH_TXSEND_SCHEDULE).next().toString()}`)
    logger.info(logDivider);

  } catch (e) {
    logger.error(logDivider);
    logger.error(`\t\t\tdaily transaction ended due to error, next scheduled ${cronParser.parseExpression(process.env.ETH_TXSEND_SCHEDULE).next().toString()}`)
    logger.error(e);
    logger.error(logDivider);
  }
});

cron.schedule(process.env.ETH_VERIFY_SCHEDULE, async () => {
  logger.info(logDivider);
  logger.info(`\t\t\t\t\thourly verification started, scheduled "${process.env.ETH_VERIFY_SCHEDULE}"`);
  logger.info(logDivider);

  try {
    await verifyPendingTransactions();

    logger.info(logDivider);
    logger.info(`\t\t\thourly verification ended, next scheduled ${cronParser.parseExpression(process.env.ETH_VERIFY_SCHEDULE).next().toString()}`)
    logger.info(logDivider);

  } catch (e) {
    logger.error(logDivider);
    logger.error(`\t\t\thourly verification ended due to error, next scheduled ${cronParser.parseExpression(process.env.ETH_VERIFY_SCHEDULE).next().toString()}`)
    logger.error(e);
    logger.error(logDivider);
  }
});

// TODO add scheduled check for approved, unsent files and send if above a threshhold

const checkJwt = jwt({
      secret: jwks.expressJwtSecret({
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 25,
          jwksUri: process.env.JWKS_URI
    }),
    audience: process.env.AUDIENCE,
    issuer: process.env.ISSUER_BASE_URL,
    algorithms: ['RS256']
});

const userScope = 'user';
const adminScope = 'admin';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(checkJwt);

app.use('/test', jwtScope(userScope), testRouter);
// app.use('/signature', jwtScope(userScope), signatureRouter);
app.use('/document', jwtScope(userScope), upload.array('uploadedDocuments'), function(req, res){ documentRouter(req, res) });
app.use('/folder', jwtScope(userScope), folderRouter);
app.use('/user', jwtScope(userScope), userRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
logger.debug(`Client requesting missing URL ${req.url}`)
  // next(createError(404));
  return res.status(404).send(`Can't find ${req.url}`);
});

function normalizePort(val) {
  const port = parseInt(val, 10);
  if (isNaN(port)) { return val; }
  if (port >= 0) { return port; }
  return false;
}

const port = normalizePort(process.env.PORT || '5000');
app.listen(port, () => {
  logger.info(`Server started, listening on port ${port}`);
});
app.on('error', onError);
app.on('listening', onListening);

const cleanup = () => {
  logger.warn(`Performing cleanup.`);
  db.end();
};

// do app specific cleaning before exiting
process.on('exit', function () {
  cleanup();
});

// catch ctrl+c event and exit normally
process.on('SIGINT', function () {
  logger.warn('Ctrl-C...');
  cleanup();
  process.exit(2);
});

//catch uncaught exceptions, trace, then exit normally
process.on('uncaughtException', function(e) {
  logger.error('Uncaught Exception...');
  logger.error(e.stack);
  cleanup();
  process.exit(99);
});

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  var bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port;

  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function onListening() {
  var addr = server.address();
  var bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  debug('Listening on ' + bind);
}

module.exports = app;
