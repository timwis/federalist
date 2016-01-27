var fs = require('fs');

var _ = require('underscore');
var Backbone = require('backbone');
var jstree = require('jstree');
var yaml = require('yamljs');

var encodeB64 = require('../../helpers/encoding').encodeB64;
var decodeB64 = require('../../helpers/encoding').decodeB64;

var templateHtml = fs.readFileSync(__dirname + '/../../templates/editor/pages.html').toString();
var itemTemplateHtml = fs.readFileSync(__dirname + '/../../templates/editor/page-list-item.html').toString();
var template = _.template(itemTemplateHtml);

var PagesView = Backbone.View.extend({
  tagName: 'div',
  className: 'pages',
  events: {
    'change #select-all': 'onSelectAll',
    'click #delete-draft': 'onDeleteDraft',
    'click #delete-page': 'onDeletePage',
    'click #publish': 'onPublish',
    'click #save-navigation': 'onSaveNavigation',
    'click [data-action=reveal-navigation-options]': 'revealNavigationOptions',
    'click [data-action=hide-navigation-options]': 'hideNavigationOptions',
    'change .jstree-node-federalist-controls-navigation': 'onNavigationChange'
  },
  initialize: function (opts) {
    opts = opts || {};
    var p = yaml.parse(opts.pages.decodedContent);
    this.pages = this.preparePageData(p);
    this.sha = opts.pages.sha;
    this.initializeJstreePlugins($);

    window.zz = this;

    if (!this.pages) throw new Error('Supply pages');

    return this;
  },
  initializeJstreePlugins: function (jQuery) {
    (function ($, undefined) {
    	$.jstree.defaults.modifynodes = $.noop;
    	$.jstree.plugins.modifynodes = function (options, parent) {
        var className = 'jstree-node-federalist-controls';
    		this.bind = function () {
    			parent.bind.call(this);
    			this.element.on("click.jstree", className, $.proxy(function (e) {
  						e.stopImmediatePropagation();
  						this.settings.modifynodes.call(this, this.get_node(e.target));
  					}, this));
    		};

    		this.teardown = function () {
    			if(this.settings.modifynodes) {
    				this.element.find(className).remove();
    			}
    			parent.teardown.call(this);
    		};

    		this.redraw_node = function(obj, deep, callback, force_draw) {
    			obj = parent.redraw_node.call(this, obj, deep, callback, force_draw);
    			if(obj) {
            var attrs = parseAttributes(obj);
            console.log('attrs', attrs);
            var el = $(template(attrs))[0];
            el.className = className;
    				obj.insertBefore(el.cloneNode(true), obj.childNodes[2]);
    			}
    			return obj;
    		};

        function parseAttributes(obj) {
          return {
            draft: JSON.parse(obj.getAttribute('data-draft-state')),
            href: [window.location.hash, obj.getAttribute('data-edit-href')].join('/'),
            menu: JSON.parse(obj.getAttribute('data-show-in-menu')),
            footer: JSON.parse(obj.getAttribute('data-show-in-footer'))
          };
        }
    	};
    })(jQuery);
  },
  preparePageData: function (pages) {
    var github = this.model;

    return replaceDataLabels(pages, 'title', 'text')
      .assigned.map(function(d) {
        return processNode(d);
      });

    function replaceDataLabels (data, find, replace) {
      var f = new RegExp(find, 'g');
      return JSON.parse(JSON.stringify(data).replace(f, replace));
    }

    function processNode (n) {
      n = insertOpenState(insertAttrs(insertData(n)));
      if (n.children) {
        n.children.map(processNode);
      }
      return n;
    }

    function insertData (i) {
      i.data = {
        menu: i.show_in_menu || false,
        footer: i.show_in_footer || false
      };
      return i;
    }

    function insertAttrs (i) {
      i.li_attr = {
        'data-edit-href': i.href,
        'data-draft-state': _.contains(github.get('drafts'), i.href),
        'data-show-in-menu': i.show_in_menu || false,
        'data-show-in-footer': i.show_in_footer || false
      };
      return i;
    }

    function insertOpenState (i) {
      i.state = {
        opened: true
      };
      return i;
    }
  },
  getJsonFromTree: function (tree) {
    return tree.jstree().get_json();
  },
  removeJsTreeAttributes: function (j) {
    var self = this;
    var n = {};
    Object.keys(j).forEach(function(k, i) {
      if (k === 'text') {
        n.text = j[k];
      }
      else if (k === 'children' && j.children.length > 0) {
        n.children = j.children.map(function (c) {
          return self.removeJsTreeAttributes(c);
        });
      }
      else if (k === 'li_attr') {
        n.href = j.li_attr['data-edit-href'];
      }
      else if (k === 'data') {
        n.show_in_menu = j.data.menu;
        n.show_in_footer = j.data.footer;
      }
    });
    return n;
  },
  generateYmlFromTree: function (tree) {
    var self = this;
    var j = this.getJsonFromTree(tree).map(function(t){
      return self.removeJsTreeAttributes(t);
    });
    var n = {
      assigned: j,
      unassigned: []
    };

    return yaml.stringify(n, 5);
  },
  render: function () {
    this.$el.html(templateHtml);
    var $ul = this.$('#assigned');

    $ul.on("changed.jstree", function (e, d) {
      console.log('e', e);
      console.log('d', d);
    });

    this.$tree = $ul.jstree({
      core: {
        check_callback: true,
        data: this.pages
      },
      checkbox: { },
      dnd: {
        large_drop_target: true
      },
      modifynodes: function (node) {
  		},
      plugins: ["changed", "checkbox", "dnd", "modifynodes", "wholerow"]
    });

    return this;
  },
  revealNavigationOptions: function (e) {
    e.stopPropagation();
    $(e.target).hide();
    $(e.target).parents('.jstree-node').first().addClass('expanded');
    $(e.target).siblings('[data-action=hide-navigation-options]').show();
    $(e.target).siblings('form').removeClass('hidden');
  },
  hideNavigationOptions: function (e) {
    e.stopPropagation();
    $(e.target).hide();
    $(e.target).parents('.jstree-node').first().removeClass('expanded');
    $(e.target).siblings('[data-action=reveal-navigation-options]').show();
    $(e.target).siblings('form').addClass('hidden');
  },
  onSelectAll: function (e) {
    var checked = e.target.checked;
    e.stopPropagation();

    if (checked) this.$tree.jstree(true).check_all();
    else this.$tree.jstree(true).uncheck_all();
  },
  onDeleteDraft: function (e) {
    e.stopPropagation();
  },
  onDeletePage: function (e) {
    e.stopPropagation();
  },
  onPublish: function (e) {
    e.stopPropagation();
  },
  onNavigationChange: function (e) {
    e.stopPropagation();
    var field = e.target.name;
    var nodeId = $(e.target).parents('.jstree-node').first().attr('id');
    var node = this.$tree.jstree(true).get_node('#' + nodeId);
    var data = node.data;

    data[field] = e.target.checked;
  },
  onSaveNavigation: function (e) {
    e.stopPropagation();

    this.model.once('github:commit:success', function (e) {
      alert('Navigation successfully saved');
    });

    this.model.commit({
      content: this.generateYmlFromTree(this.$tree),
      message: 'Update site navigation',
      path: '_data/navbar.yml',
      sha: this.sha
    });
  }
});

module.exports = PagesView;
