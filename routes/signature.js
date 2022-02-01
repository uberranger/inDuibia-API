const express = require('express');
const crypto = require('crypto');

const logger = require('../util/logger');
const db = require('../util/db');

const router = express.Router();

const iterations = parseInt(process.env.ITERATIONS);
const keyLength = parseInt(process.env.KEY_LENGTH);

router.post('/submit', async (req, res) => {
  const { fullName, lastFourSSN, birthDate, contractHash } = req.body;

  const clientInformation = {
    ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.header('user-agent'),
  }

  const ambientInformation = {
    timestamp: Date.now(),
  };

  const itemInformation = {
// TODO get contract hash and include it
    fullName,
    lastFourSSN,
    birthDate,
    contractHash,
  };

  const plainSignature = JSON.stringify({
    clientInformation,
    ambientInformation,
    itemInformation
  });

  const salt = crypto.randomBytes(process.env.SALTINESS);

  crypto.pbkdf2(plainSignature, salt, iterations, keyLength, 'sha512', async (err, derivedKey) => {
     if (err) {
       logger.error(err);
       return res.status(500).send('whoopsies');

     }
     else {
       try{
         const test = await db.query('SELECT $1::text as message', ['Hello world!']);
       } catch (e) {
         logger.error(e);
       }
       const hexDerivedKey = derivedKey.toString('hex');
       return res.status(200).send({ plainSignature, salt, iterations, keyLength, hexDerivedKey });
     }
   });


});

module.exports = router;
