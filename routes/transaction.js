const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

const db = require('../util/db');
const logger = require('../util/logger');

const router = express.Router();

const getSalt = () => {
  return crypto.randomBytes(parseInt(process.env.SALTINESS));
};

const iterations = parseInt(process.env.ITERATIONS);
const keyLength = parseInt(process.env.KEY_LENGTH);

router.post('/create', async (req, res, next) => {

  const salt = getSalt();
  const transactionID = getSalt();

  crypto.pbkdf2(transactionID, salt, iterations, keyLength, 'sha512', async (err, derivedKey) => {
     if (err) {
       logger.error(err);
       return res.status(500).send('whoopsies');
     }
     else {
       const hexDerivedKey = derivedKey.toString('hex');
       const insertQuery = 'INSERT INTO transactions (id, date_ingested) VALUES ($1, $2)';
       const insertValues = [hexDerivedKey, new Date()];
       logger.debug(`query transaction attempt:\n\t${insertQuery}\n\t${insertValues}`);

       db.query(insertQuery, insertValues, (qErr, qRes) => {
         if (qErr) {
           logger.error(qErr);
           return res.status(500).send(qErr);
         } else {
           logger.debug(`query ${qRes.command} transaction success: ${qRes.fields}, ${qRes.text}`);
           return res.status(200).send({ transactionID, salt, iterations, keyLength, hexDerivedKey });
         }
        });
        // res.send('boobies');
      }
   });
});

module.exports = router;
