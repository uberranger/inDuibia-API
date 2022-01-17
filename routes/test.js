const express = require('express');
const router = express.Router();

router.get('/', function(req, res, next) {
  res.status(200).send('test');
  console.log('we got a request for test');
});

module.exports = router;
