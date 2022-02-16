module.exports = require('pino')({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'hostname, pid'
    },
  },
  level: process.env.LOG_LEVEL || 'error',
  levelFirst: true,
});
