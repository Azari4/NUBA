const serverless = require('serverless-http');
const app = require('../../server'); // Import our Express app

// Wrap the Express app for Serverless
module.exports.handler = serverless(app);
