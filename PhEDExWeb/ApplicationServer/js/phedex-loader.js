/**
 * The PhEDEx Application.
 * @module PHEDEX
 */

/**
 * The PHEDEX global namespace object.
 * @class PHEDEX
 */
PHEDEX= {}

/** 
 * Creates a namespace rooted from PHEDEX.
 * @method namespace
 * @param namespace {string} Namespace to create, optionally with  dot-notation, e.g. 'Appserv' or 'Base.Object'.
 * @return {object} The namespace created.
 */
// For more information, see: http://yuiblog.com/blog/2007/06/12/module-pattern/
PHEDEX.namespace = function() {
    var a=arguments, o=null, i, j, d;
    for (i=0; i<a.length; i=i+1) {
        d=(""+a[i]).split(".");
        o=PHEDEX;

        // PHEDEX is implied, so it is ignored if it is included
        for (j=(d[0] == "PHEDEX") ? 1 : 0; j<d.length; j=j+1) {
            o[d[j]]=o[d[j]] || {};
            o=o[d[j]];
        }
    }

    return o;
};

/**
 * Contains application globals.
 * @namespace PHEDEX
 * @class Appserv
 */
PHEDEX.Appserv = {};

/**
 * Sets the version of the application, using a string set by the RPM build or a default.
 * @method makeVersion
 * @namespace PHEDEX.Appserv
 * @protected
 * @return {string} The version string
 */
PHEDEX.Appserv.makeVersion = function() {
  var version = '@APPSERV_VERSION@'; // set when RPM is built
  return version.match(/APPSERV_VERSION/) ? '0.0.0' : version;
};

/**
 * The version of the application.
 * @property Version
 * @type string
 * @public
 */
PHEDEX.Appserv.Version = PHEDEX.Appserv.makeVersion();

/**
 * Base object for all graphical entities in the application.
 * @namespace PHEDEX.Base
 * @class Object
 * @constructor
 */
PHEDEX.namespace('Base');
PHEDEX.Base.Object = function() {
  return {
    /**
     * Namespace for DOM elements managed by this object.
     * @property dom
     * @type object
     * @protected
     */
    dom: {},

    /**
     * Namespace for control elements managed by this object.
     * @property ctl
     * @type object
     * @protected
     */
    ctl: {},

    /**
     * Namespace for options in effect for this object.
     * @property options
     * @type object
     * @protected
     */
    options: {},

    /**
     * Decorations to apply for this object. E.g, context-menus, 'extra' handlers etc
     * @property decorators
     * @type object
     * @protected
     */
    decorators: {},
  };
}

/**
 * on-demand loading of all phedex code and the YUI code it depends on
 * @namespace PHEDEX
 * @class Loader
 * @constructor
 * @param {object} options contains options for the YAHOO.util.Loader. Can (should!) be empty
 */

PHEDEX.Loader = function(opts) {
  /**
   * dependency-relationships between PhEDEx classes, and between PhEDEx classes and YUI. Needs to be updated every time a
   * new file is added to the distribution, or when objects are changed to depend on more or fewer files
   * @property _dependencies
   * @type object
   * @protected
   */
  var _dependencies = {
    'phedex-css':     { type: 'css', fullpath: '/css/phedex.css' },
    'phedex-util':    { requires: ['phedex-css'] },
    'phedex-datasvc': { requires: ['phedex-util','json'] },
    'phedex-util-idletimer': { },

    'phedex-component-control':     { requires:['phedex-util','animation'] },
    'phedex-component-contextmenu': { requires:['phedex-util','menu'] }, //'phedex-registry'] },
    'phedex-component-splitbutton': { requires:['phedex-util','menu','button'] },

//     'phedex-core-filter':      { requires:['phedex-util'] },
//     'phedex-global-filter':    { requires:[] },
//     'phedex-core-widget-registry': { requires: ['phedex-util'] },
//     'phedex-navigator': { requires: ['phedex-core-widget','phedex-widget-nodes','autocomplete','button'] },

    'phedex-logger':    { requires:['phedex-util', 'logger'] },
    'phedex-sandbox':   { requires:['phedex-util'] },
    'phedex-core':      { requires:['phedex-sandbox'] },
    'phedex-module':    { requires:['phedex-core','container','resize'] },
    'phedex-datatable': { requires:['datatable'] },
    'phedex-treeview':  { requires:['treeview'] },
    'phedex-module-nodes':  { requires:['phedex-module','phedex-datatable'] },
    'phedex-module-agents': { requires:['phedex-module','phedex-datatable'] },
  },

      _me = 'PxLoader',
      _busy = false,
      _success,
      _on = {},
      _loader = new YAHOO.util.YUILoader(),
      _conf = {
        loadOptional:  true,
        allowRollup:  false,
        base:        '/yui/build/',
        timeout:      15000,
        onSuccess:  function(item) { _callback([_me, 'Success',  _loader.inserted]); },
        onProgress: function(item) { _callback([_me, 'Progress', item]); },
        onFailure:  function(item) { _callback([_me, 'Failure',  item]); },
        onTimeout:  function(item) { _callback([_me, 'Timeout',  item]); },
      };

/**
 * handles events from the loader, specifically <strong>Progress</strong>, <strong>Success</strong>, <strong>Failure</strong>, and <strong>Timeout</strong>. Calls the user-defined function, if any, to handle that particular event. Logs all events, using the default group/severity.
 * @method _callback
 * @private
 */
  var _callback = function(args) {
    var ev   = args[0],
        type = args[1],
        item = args[2];
    switch (type) {
      case 'Progress': { log(ev+': '+type+', '+item.name); break; }
      case 'Success':  {
        var l='';
        for (var i in item) { l += i+' ';};
        log(ev+': '+type+', '+l);
        _busy = false;
        break;
      }
      case 'Failure':  { log(ev+': '+type+', '+item.msg,'error',_me); _busy = false; break; }
      case 'Timeout':  { log(ev+': '+type,'error',_me); _busy = false; break; }
    };
    if ( _on[type] ) { setTimeout( function() { _on[type](item); },0); }
  };

/**
 * @method _init
 * @private
 * @param {object} config the default options updated with the configuration object passed in to the constructor
 */
  var _init = function(cf) {
    for (var i in cf) {
      _loader[i] = cf[i];
    }
  };

  if ( opts ) {
    for (var i in opts) { _conf[i] = opts[i]; }
  }
  _init(_conf);

  for (var i in _dependencies) {
    var x = _dependencies[i];
    x.name = i;
    if ( !x.type ) { x.type = 'js'; }
    if ( !x.fullpath ) { x.fullpath = '/'+x.type+'/'+x.name+'.'+x.type; }
    if ( !x.requires ) { x.requires = []; }
    _loader.addModule(x);
  }

  return {
/**
 * asynchronously load one or more javascript or CSS source files from the PhEDEx and YUI installations
 * @method load
 * @param {object|function} callback function to be called on successful loading, or object containing separate callbacks for each of the <strong>Progress</strong>, <strong>Success</strong>, <strong>Failure</strong>, and <strong>Timeout</strong> keys.<br/>The callbacks are passed an argument containing information about the item that triggered the call.
 * <br/><strong>Progress</strong> and <strong>Failure</strong> both have the name of the relevant source file in <strong>item.name</strong>.
 * <br/><strong>Timeout</strong> doesn't have any useful information about which source file triggered the timeout, but you can inspect the return of <strong>loaded()</strong> for more information.
 * <br/><strong>Success</strong> is called with the list of loaded modules.<br>&nbsp;
 * @param {arbitrary number of strings|single array of strings} modules these are the modules to load.<br/>Either a series of additional string arguments, or an array of strings. Each string is either a PhEDEx or a YUI component name. In the case of PhEDEx components, the leading <strong>phedex-</strong> can be omitted, it is assumed if there is a matching component. This means that PhEDEx components can mask YUI components in some cases. E.g, a PhEDEx component stored in a file <strong>phedex-button.js</strong> would mask the YUI <strong>button</strong> component. This can be covered in the <strong>_dependencies</strong> map, where items that a component requires are named in full.
 */
    load: function( args, what ) {
      if ( _busy ) {
        setTimeout( function(obj) {
          return function() {
            obj.load(args,what);
          }
        }(this),100);
        return;
      }
      _busy = true;
      var _args = Array.apply(null,arguments);
      _args.shift();
      if ( typeof(_args[0]) == 'object' || typeof(_args[0]) == 'array' ) { _args = _args[0]; }
      setTimeout( function() {
        if ( typeof(args) == 'function' ) { _on.Success = args; }
        else {
          _on = {};
          for (var i in args) { _on[i] = args[i]; }
        }
        for (var i=0; i<_args.length; i++)
        {
          var m = _args[i];
          if ( _dependencies['phedex-'+m] ) { m = 'phedex-'+m; }
          _loader.require(m);
        }
        _loader.insert();
      }, 0);
    },
/**
 * Initialise the loader. Called internally in the constructor, you only need to call it if you wish to override something.
 * @method init
 * @param config {object} configuration object. Takes the same keys at the YUI loader.
 */
    init: function(args) { _init(args); },

/**
 * @method loaded
 * @return {string} with a full list of modules loaded by this loader. This is the full list since the loader was instantiated, so will grow monotonically if the loader is used several times
 */
    loaded: function() { return _loader.inserted; },

/**
 * @method knownModules
 * @return {array} list of all source-files matching <strong>/^phedex-module-/</strong>. Use this to determine the names of instantiatable data-display modules before they are loaded.
 */
    knownModules: function() {
      var km=[];
      for (var str in _dependencies) {
        if ( str.match('^phedex-module-(.+)$') ) {
          km.push(RegExp.$1);
        }
      }
      return km;
    },
  }
}
