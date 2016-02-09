var Sails = require('sails'),
  sails;

GLOBAL.helpers = require('./helpers');

delete process.env.GITHUB_TOKEN;

before(function(done) {
  this.timeout(35000);

  Sails.lift({
    // configuration for testing purposes
    // Use memory for data store
    models: { connection: 'memory' },
    log: { level: 'info' }
  }, function(err, server) {
    sails = server;
    if (err) return done(err);
    // here you can load fixtures, etc.
    done(err, sails);
  });
});

after(function(done) {
  // here you can clear fixtures, etc.
  sails.lower(done);
});
