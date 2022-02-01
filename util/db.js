const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  database: process.env.DATABASE,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

logger.debug(`Database connection established:\n\tdatabase: ${process.env.DATABASE},
\thost: ${pool.options.host},
\tport: ${pool.options.port},
\tuser: ${pool.options.user}`);

module.exports = {
  async query(text, params, next) {
    try {
      const res = await pool.query(text, params, (qErr, qRes) => {
        next(qErr, qRes);
      });
    } catch (error) {
      logger.error(error);
    }
  },
  async query(text, params) {
    try {
      return await pool.query(text, params);
    } catch (error) {
      throw error;
    }
  },
  end() {
    logger.debug(`Ending database connection:
      \tdatabase: ${process.env.DATABASE},
      \thost: ${process.env.DB_HOST},
      \tport: ${process.env.DB_PORT},
      \tuser: ${process.env.DB_USER},
      \tpassword: ***`);
    pool.end();
  }
};
