var _ = require('underscore');
var $ = require('jquery');
var async = require('async');
var Backbone = require('backbone');
var yaml = require('yamljs');

var encodeB64 = require('../helpers/encoding').encodeB64;
var decodeB64 = require('../helpers/encoding').decodeB64;

var GithubModel = Backbone.Model.extend({
  initialize: function (opts) {
    opts = opts || {};
    if (!opts.token) throw new Error('Must provide Github OAuth token');

    this.owner = opts.owner;
    this.name = opts.repoName;
    this.branch = opts.branch;
    this.token = opts.token;
    this.file = opts.file;
    this.site = opts.site;
    this.assets = [];
    this.uploadDir = opts.uploadRoot || 'uploads';

    this.once('github:fetchConfig:success', function () {
      this.fetchDrafts();
    }.bind(this));

    this.once('github:fetchDrafts:success', function () {
      this.fetchAssets();
      this.fetch();
    }.bind(this));

    this.fetchConfig();

    return this;
  },
  url: function (opts) {
    opts = opts || {};
    var ghUrl = 'https://api.github.com',
        route = opts.route || 'repos',
        owner = opts.owner || this.owner,
        repository = opts.repository || this.name,
        baseUrl = [ghUrl, route],
        qs = $.param(_.extend({
          access_token: this.token,
          ref: this.branch
        }, opts.params || {}));

    if (opts.method) baseUrl.push(opts.method);
    else if (opts.root) baseUrl.push(owner, repository);
    else baseUrl.push(owner, repository, 'contents');

    if (opts.path) baseUrl.push(opts.path);
    else if (this.file) baseUrl.push(this.file);

    return [baseUrl.join('/'), qs].join('?');
  },
  parse: function (res) {
    var attrs = {
      json: res,
      type: 'directory'
    };

    if (res.type) attrs.type = res.type;
    return attrs;
  },
  commit: function (opts, done) {
    var self = this,
        // ProseMirror encodes these characters, so this decodes them
        // https://github.com/18F/federalist/issues/299
        content = opts.content && opts.content
          .replace(/%7B/g, '{')
          .replace(/%7D/g, '}'),
        data = {
          path: opts.path || this.file,
          message: opts.message,
          content: opts.base64 || encodeB64(content),
          branch: this.branch
        };
    done = done || _.noop;

    if (this.attributes.json && this.attributes.json.sha) {
      data.sha = this.attributes.json.sha;
    }

    $.ajax(this.url({ path: data.path }), {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + this.token,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(data),
      complete: function (res) {
        var e = { request: data, response: res.status };

        if (res.status !== 200 && res.status !== 201) {
          self.trigger('github:commit:error', e);
          return done(e);
        }

        self.attributes.json = self.attributes.json || {};
        self.attributes.json.sha = res.responseJSON.content.sha;

        // if this is an uploaded asset
        if (data.path.match(self.uploadDir)) {
          // refresh internal store of assets
          self.fetchAssets.call(self);
          window.federalist.dispatcher.trigger('github:upload:success', res.responseJSON);
        } else {
          self.trigger('github:commit:success', e);
          return done(null, e);
        }

      }
    });
  },
  createDraftBranch: function(done) {
    var branchName = '_draft-' + encodeB64(this.get('file'));
    var url = this.url({
      root: true,
      path: 'git/refs',
      params: { ref: undefined }
    });
    var sha = this.get('defaultSHA');

    if (!sha) return done('No SHA available');

    $.ajax({
      method: 'POST',
      dataType: 'json',
      contentType: 'application/json; charset=utf-8',
      url: url,
      data: JSON.stringify({
        ref: 'refs/heads/' + branchName,
        sha: sha
      }),
      success: function(res) {
        this.branch = branchName;
        this.set('branch', branchName);
        done(null, res);
      }.bind(this),
      error: done
    });

  },
  createPR: function(done) {
    var url = this.url({ root: true, path: 'pulls' });

    $.ajax({
      method: 'POST',
      dataType: 'json',
      contentType: 'application/json; charset=utf-8',
      url: url,
      data: JSON.stringify({
        title: 'Draft updates for ' + this.get('file'),
        body: '',
        head: this.get('branch'),
        base: this.get('defaultBranch')
      }),
      success: function(res) {
        done(null, res);
      }.bind(this),
      error: done
    });

  },
  getPR: function(done) {
    var url = this.url({
      root: true,
      path: 'pulls',
      params: {
        per_page: 100
      }
    });

    $.ajax({
      url: url,
      data: {
        head: this.get('branch')
      },
      success: function(res) {
        this.set('pr', res[0].number);
        done(null, res);
      }.bind(this),
      error: done
    });

  },
  save: function(opts, done) {
    done = done || _.noop;

    // if on a branch, pass through to commit
    if (this.get('branch') !== this.get('defaultBranch')) {
      return this.commit(opts, done);
    }

    async.series([
      this.createDraftBranch.bind(this),
      this.commit.bind(this, opts),
      this.createPR.bind(this)
    ], done);

  },
  publish: function(opts, done) {
    async.series([
      this.save.bind(this, opts),
      this.getPR.bind(this),
      this.mergePR.bind(this),
      this.deleteBranch.bind(this)
    ], done);
  },
  mergePR: function(done) {
    if (!this.get('pr')) return done('PR not available');

    var url = this.url({
      root: true,
      path: 'pulls/' + this.get('pr') + '/merge'
    });

    $.ajax({
      method: 'PUT',
      dataType: 'json',
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify({
        commit_message: 'Merged via Federalist'
      }),
      url: url,
      success: function(res) {
        this.set('pr', undefined);
        done(null, res);
      }.bind(this),
      error: done
    });

  },
  deleteBranch: function(done) {
    if (this.get('branch') === this.get('defaultBranch')) {
      return done('Unable to delete default branch');
    }

    var ref = 'heads/' + this.get('branch');
    var url = this.url({
      root: true,
      path: 'git/refs/' + ref
    });

    $.ajax({
      method: 'DELETE',
      url: url,
      success: function(res) {
        this.set('branch', this.get('defaultBranch'));
        done(null, res);
      }.bind(this),
      error: done
    });

  },
  /*
   * Clone a repository to the user's account.
   * @param {Object} source - The source repo to clone.
   * @param {string} source.owner - The source repo's owner.
   * @param {string} source.repository - The source repo's name.
   * @param {Object} destination - The destination repository.
   * @param {string} destination.repository - The destination repo's name.
   * @param {string} destination.organization - The destination repo's owner org (optional).
   * @param {string} destination.branch - The destination repo's branch (optional).
   * @param {string} destination.engine - The destination repo's build engine (optional).
   * @param {function} done - The callback function.
   */
  clone: function clone(source, destination, done) {
    var model = this;
    var method = model.clone;
    var err;

    if (!source || !source.owner || !source.repository || !destination) {
      err = new Error('Missing source or destination');
      return done ? done(err) : err;
    }

    method.checkSource = function checkDestination(done) {
      var url = model.url({
        root: true, owner: source.owner, repository: source.repository
      });

      $.ajax({
        dataType: 'json',
        url: url,
        success: done.bind(this, null),
        error: done
      });
    };

    method.createRepo = function createRepo(done) {
      var route = destination.organization ?
        'orgs/' + destination.organization : 'user';
      var url = model.url({ route: route, method: 'repos' });
      var data = { name: destination.repository };

      $.ajax({
        method: 'POST',
        dataType: 'json',
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify(data),
        url: url,
        success: done.bind(this, null),
        error: done
      });

    };

    method.cloneRepo = function cloneRepo(done) {
      var url = '/v0/site/clone';
      var data = {
        sourceOwner: source.owner,
        sourceRepo: source.repository,
        destinationOrg: destination.organization,
        destinationRepo: destination.repository,
        destinationBranch: destination.branch || this.branch,
        engine: destination.engine || 'jekyll'
      };
      $.ajax({
        method: 'POST',
        dataType: 'json',
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify(data),
        url: url,
        success: done.bind(this, null),
        error: done
      });
    };

    if (done) async.series([
      method.checkSource.bind(this),
      method.createRepo.bind(this),
      method.cloneRepo.bind(this)
    ], done);

    return this;
  },
  s3ConfigUrl: function (file) {
    var bucketPath = /^http\:\/\/(.*)\.s3\-website\-(.*)\.amazonaws\.com/,
        siteRoot = (this.site) ? this.site.get('siteRoot') : '',
        match = siteRoot.match(bucketPath),
        bucket = match && match[1],
        root = bucket ? 'https://s3.amazonaws.com/' + bucket :
               siteRoot ? siteRoot : '';

    return [root, 'site', this.owner, this.name, file].join('/');
  },
  githubConfigUrl: function (file) {
    var ghBase = 'https://raw.githubusercontent.com';
    return [ghBase, this.owner, this.name, this.branch, file].join('/');
  },
  configUrl: function (opts) {
    var file = opts.name,
        source = opts.source || 's3',
        url = (source === 's3') ? this.s3ConfigUrl(file) : this.githubConfigUrl(file);

    return url;
  },
  fetchConfig: function () {
    var self  = this,
        files = [{ name: '_config.yml', source: 'github' },
                { name: '_navigation.json', source: 's3' }];

    var getFiles = files.map(function(file) {
      return function(callback) {
        var url = self.configUrl(file);
        $.ajax({
          url: url,
          complete: function(res) {
            var r = {
              file: file.name,
              present: (res.status === 200) ? true : false
              //json: res.responseJSON || yaml.parse(res.responseText)
            };
            try {
              r.json = res.responseJSON || yaml.parse(res.responseText);
            } catch (e) {
              r.json = [];
            }
            callback(null, r);
          }
        });
      };
    });

    async.parallel(getFiles, function (err, results) {
      if (err) return self.trigger('github:fetchConfig:error');

      self.configFiles = {};

      results.forEach(function(r) {
        self.configFiles[r.file] = {
          present: r.present,
          json: r.json
        };
      });

      self.trigger('github:fetchConfig:success');
    });

    return this;
  },
  fetchAssets: function () {
    var self = this;

    $.ajax({
      url: this.url({ path: 'uploads' }),
      method: 'GET',
      complete: function (res) {
        if (res.status === 200) {
          self.assets = res.responseJSON;
          self.trigger('github:fetchAssets:success', self.assets);
        }
        else {
          self.trigger('github:fetchAssets:error', res.status);
        }
      }
    });
  },
  fetchDrafts: function() {
    var self = this;
    var url = this.url({
      root: true,
      path: 'branches',
      params: {
        per_page: 100
      }
    });
    $.ajax({
      url: url,
      success: function(data) {
        var drafts = _(data).chain().filter(function(branch) {
          return branch.name && branch.name.indexOf('_draft-') === 0;
        }).map(function(branch) {
          return decodeB64(branch.name.replace('_draft-', ''));
        }).compact().value();
        if (!self.site) return;
        var defaultSHA = _.findWhere(data, {
          name: self.site.get('defaultBranch')
        }).commit.sha;
        self.set('drafts', drafts);
        self.set('defaultSHA', defaultSHA);
        self.trigger('github:fetchDrafts:success');
      },
      error: function(res) {
        self.trigger('github:fetchDrafts:error', res.status);
      }
    });
  },
  filterAssets: function (type) {
    var regexByType = {
      'images': /\.jpg|\.jpeg|\.png|\.gif/,
      'documents': /\.doc|\.docx|\.pdf/
    };

    if (type === 'image') type = 'images';

    return this.assets.filter(function(a) {
      var isOfType = a.name.match(regexByType[type]);
      return isOfType;
    });
  },
  getDefaults: function () {
    var config = this.configFiles['_config.yml'],
        hasDefaults = config.present && config.json && config.json.defaults,
        defaultConfigs = (hasDefaults) ? config.json.defaults : [],
        defaults = defaultConfigs.filter(function (c) {
          return c.scope.path === "";
        }),
        d = (defaults.length > 0) ? yaml.dump(defaults[0].values) : '\n';

    return d;
  },
  getLayouts: function () {
    var defaultString = this.getDefaults(),
        defaults = yaml.parse(defaultString) || '',
        layouts = defaults.layout || ['default'];

    return layouts;
  }
});

module.exports = GithubModel;
