const crypto = require('crypto');

const getSalt = () => {
  return crypto.randomBytes(parseInt(process.env.SALTINESS));
};

const bufferToHex = (buffer) => {
  return [...new Uint8Array(buffer)]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
}

const makeHash = (documentData, salt = getSalt(), iterations = parseInt(process.env.ITERATIONS), keyLength = parseInt(process.env.KEY_LENGTH)) => crypto.pbkdf2Sync(documentData, salt, iterations, keyLength, 'sha512');


module.exports = { makeHash, bufferToHex };
