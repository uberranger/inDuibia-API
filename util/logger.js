module.exports = require('pino')({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    },
  },
  level: process.env.LOG_LEVEL || 'error',
  translateTime: true,
  levelFirst: true,
});
