const express = require('express');
const crypto = require('crypto');
const { Client } = require('pg');

require('dotenv').config();

const router = express.Router();

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.SIGNATURE_DB,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});
// console.log(client);

const getSalt = () => {
  return 'tempSalt';
};

const iterations = 100000;
const keyLength = 64;

router.post('/create', async (req, res, next) => {
  const { fullName, lastFourSSN, birthDate } = req.body;

  const clientInformation = {
    fullName,
    lastFourSSN,
    birthDate,
    ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.header('user-agent'),
  }

  const ambientInformation = {
    timestamp: Date.now(),
  };

  const intrinsicInformation = {
// TODO get contract hash and include it
    contractHash: '',
  };

  const plainSignature = JSON.stringify({
    clientInformation,
    ambientInformation,
  });

  const salt = getSalt();
  // console.debug(plainSignature);

  crypto.pbkdf2(plainSignature, salt, iterations, keyLength, 'sha512', async (err, derivedKey) => {
     if (err) {
       console.error(err);
       res.status(500).send('whoopsies');

     }
     else {
       try{
         await client.connect();
         const test = await client.query('SELECT $1::text as message', ['Hello world!']);
         console.log(test.rows[0].message);
         await client.end();
       } catch (e) {
         console.error(e);
         await client.end();
       }
       const hexDerivedKey = derivedKey.toString('hex');
       console.debug();
       res.status(200).send({ plainSignature, salt, iterations, keyLength, hexDerivedKey });
     }
   });


});

module.exports = router;
