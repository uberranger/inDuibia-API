const express = require('express');
const router = express.Router();
const logger = require('../util/logger');

router.post('/', function(req, res) {
  logger.info('we got a request for test');
  logger.info(req.user);
  return res.status(200).send('test response');
});

module.exports = router;
