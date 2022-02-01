const express = require('express');
const axios = require('axios');

const db = require('../util/db');
const logger = require('../util/logger');

const router = express.Router();

const iterations = parseInt(process.env.ITERATIONS);
const keyLength = parseInt(process.env.KEY_LENGTH);

const getUser = async (token) => axios({
  method: 'get',
  url: `${process.env.DOMAIN}/userinfo`,
  headers: { authorization: `Bearer ${token}` },
  });

router.post('/profile', async (req, res) => {

  logger.debug(`retrieving user information for , ${req.user.sub} from ${req.user.aud}`);
  const userInfoResponse = await getUser(req.headers.authorization.split(' ')[1]);
  const { email, first_name, last_name } = userInfoResponse.data;

  logger.debug(`user information found for ${userInfoResponse.data.email}`);
  return res.status(200).send(userInfoResponse.data);
});

router.post('/ownedDocuments', async (req, res) => {
  try{
    const userInfoResponse = await getUser(req.headers.authorization.split(' ')[1]);
    const { email, first_name, last_name } = userInfoResponse.data;

    const userInfoDBResponse = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userInfoDBResponse.rowCount === 0) {
      logger.warn(`user entry not found for ${email} in user table, creating`);
      const userCreationDBResponse = await db.query('INSERT INTO users (email, first_name, last_name) VALUES ($1, $2, $3)', [email, first_name, last_name]);
    }
    const documentListDBResponse = await db.query('SELECT documents.* from users, documents WHERE documents.owner_id = users.id AND users.email = $1', [email]);
    // logger.debug(documentListDBResponse.rows[0]);
    return res.status(200).send(documentListDBResponse.rows);

  } catch (e) {
      logger.error(e);
      return res.status(500).send('Error finding user');
    }
  });

module.exports = { router, getUser };
