var assert = require('assert');
var _ = require('underscore');
var request = require('request');
var Q = require('q');

var NewSitePage = require('./pageobjects/newSite.page');

var newSitePage;

before(function () {
  this.timeout(25000);
  newSitePage = new NewSitePage(helpers.webdriver.createDriver());
  return newSitePage.init();
});

after(function () {
  // return newSitePage.end();
});

describe('new site page integration tests', function () {
  this.timeout(25000);

  it('logs in', function () {
    return newSitePage.login();
  });

  describe('for non-existent repository', function () {
    it('opens new site', function () {
      return newSitePage.open();
    });

    it('has form', function () {
      return newSitePage.driver
        .isExisting('form');
    });

    it('prefills github user', function () {
      return newSitePage.getOwner()
        .then(function (owner) {
          assert.ok(owner);
        });
    });

    it('enters non-existent repository name', function () {
      return newSitePage.setRepository('foo');
    });

    it('submits the form', function () {
      return newSitePage.submit();
    });

    it('flashes error', function () {
      return newSitePage
        .flashMessage()
        .then(function (message) {
          assert.equal(message, 'Unable to access the repository');
        });
    });
  });

  describe('from template', function () {
    it('opens new site', function () {
      return newSitePage.open();
    });

    it('has templates', function () {
      return newSitePage
        .templateElements()
        .then(function (templates) {
          assert.notEqual(templates.length, 0);
        });
    });

    describe('using the third template', function () {
      var templateElement;
      beforeEach(function () {
        return newSitePage.templateElements()
          .then(function (templateElements) {
            templateElement = templateElements[2];
          });
      });

      describe('for an existing repo', function () {
        it('clicks the the third one', function () {
          return templateElement
            .useThisTemplateElement()
            .click();
        });

        it('enters name of the new site', function () {
          return templateElement
            .setNewSiteName('foo-xyz');
        });

        it('submits the new site form', function () {
          return templateElement
            .submitNewSiteName();
        });

        it('flashes an error message', function() {
          return newSitePage.flashMessage()
            .then(function (message) {
              assert.equal(message, 'We encountered an error while making your website: name already exists on this account');
            });
        });
      });

      describe('for a new repo', function () {
        var repoName, ghToken;
        before(function () {
          var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
          repoName = 'foo-' + _.range(10)
            .map(function () {
              // _.sample(x, 10), only returns combinations, not permutations,
              // so repeat the sample call as many times as we want.
              return _.sample(characters);
            })
            .join('');
        });

        after(function (done) {
          var opts = {
            url: ['https://api-github-com-gwqynjms41pa.runscope.net/repos', process.env.FEDERALIST_TEST_USER, repoName].join('/'),
            headers: {
              'Authorization': 'token ' + process.env.FEDERALIST_TEST_TOKEN,
              'User-Agent': 'Federalist Tests'
            }
          };

          newSitePage.driver.waitUntil(function() {
            return Q.Promise(function(resolve, reject) {
              request.get(opts, function (err, res) {
                if (err) reject(err);

                if (res.statusCode === 200) {
                  resolve();
                }  else {
                  reject();
                }
              })
            })
          })
          .then(function() {
            return request.del(opts, done);
          });
        });

        it('opens new site', function () {
          return newSitePage.open();
        });

        it('clicks the the first one', function () {
          return templateElement
            .useThisTemplateElement()
            .click();
        });

        it('enters name of the new site', function () {
          return templateElement
            .setNewSiteName(repoName);
        });

        it('submits the new site form', function () {
          return templateElement
            .submitNewSiteName();
        });

        it('redirects to homepage', function () {
          return newSitePage.driver.url()
            .then(function (url) {
              assert.equal(url.value, 'http://localhost:1337/#');
            });
        });

        // it('shows up on home page', function () {
        //   TODO
        // });

        // it('flashes an error message', function() {
        //   return newSitePage.flashMessage()
        //     .then(function (message) {
        //       assert.equal(message, 'We encountered an error while making your website: name already exists on this account');
        //     });
        // });
      });
    });
  });
});
