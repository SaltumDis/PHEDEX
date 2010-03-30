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
    'treeview-css':   { type: 'css', fullpath: '/yui/examples/treeview/assets/css/menu/tree.css' },
    'phedex-css':     { type: 'css', fullpath: '/css/phedex.css' },
    'phedex-util':    { requires: ['phedex-css'] },
    'phedex-datasvc': { requires: ['phedex-util','connection','json'] },
    'phedex-util-idletimer': { },

    'phedex-component-control':     { requires:['phedex-util','animation'] },
    'phedex-component-contextmenu': { requires:['phedex-util','phedex-registry','menu'] },
    'phedex-component-filter':      { requires:['phedex-util','phedex-component-control','container','dragdrop','button'] },
    'phedex-component-menu':        { requires:['phedex-util','menu','button'] },
    'phedex-component-splitbutton': { requires:['phedex-util','menu','button'] },

    'phedex-config':       { requires:['phedex-util'] },
    'phedex-login':        { requires:['phedex-util','button'] },
    'phedex-navigator':    { requires: ['phedex-registry','phedex-config','history','autocomplete','button'] },
    'phedex-globalfilter': { requires: ['phedex-component-filter'] },

    'phedex-profiler':  { requires:['phedex-util','profiler','datatable'] },
    'phedex-registry':  { requires:['phedex-util'] },
    'phedex-logger':    { requires:['phedex-util','logger','connection','cookie'] },
    'phedex-sandbox':   { requires:['phedex-util'] },
    'phedex-core':      { requires:['phedex-sandbox'] },
    'phedex-module':    { requires:['phedex-core','container','resize'] },
    'phedex-datatable': { requires:['datatable'] },
    'phedex-treeview':  { requires: ['treeview', 'treeview-css'] },
    'phedex-module-nodes':      { requires:['phedex-module','phedex-datatable'] },
    'phedex-module-agents':     { requires:['phedex-module','phedex-datatable'] },
    'phedex-module-linkview':   { requires:['phedex-module','phedex-treeview'] },
    'phedex-module-groupusage': { requires:['phedex-module','phedex-datatable'] },
    'phedex-module-static':     { requires: ['phedex-module', 'phedex-config'] },
    'phedex-module-blocklocation': { requires: ['phedex-module', 'slider', 'button'] },
    'phedex-module-missingfiles': { requires: ['phedex-module', 'phedex-datatable'] },
    'phedex-module-agentlogs': { requires: ['phedex-module', 'phedex-datatable'] },
    'phedex-module-queuedmigrations': { requires: ['phedex-module', 'phedex-datatable'] },

    'phedex-module-dummy':          { requires:['phedex-module'] },
    'phedex-module-dummy-treeview': { requires:['phedex-module','phedex-treeview'] }
  },

  _me = 'PxLoader',
  _busy = false,
  _success,
  _on = {},
  _loader = new YAHOO.util.YUILoader(),
  _conf = {
    loadOptional: true,
    allowRollup:  true,
// played around with combo-loading, but that didn't work properly with the proxy. Forget it for now...
//     combine:      false,
//     comboBase:   '/phedex/datasvc/combo?',
//     root:        '/yui/build/',
    base:        PHEDEX.Appserv.BaseURL + '/yui/build/',
    timeout:      15000,
    onSuccess:  function(item) { _callback([_me, 'Success',  _loader.inserted]); },
    onProgress: function(item) { _callback([_me, 'Progress', item]); },
    onFailure:  function(item) { _callback([_me, 'Failure',  item]); },
    onTimeout:  function(item) { _callback([_me, 'Timeout',  item]); }
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
        banner('loading complete');
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
    if ( !x.fullpath.match(/yui/) ) {
      x.fullpath = PHEDEX.Appserv.BaseURL + x.fullpath;
    }
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
    load: function( args ) {
      var _args = Array.apply(null,arguments);
      _args.shift();
      if ( typeof(_args[0]) == 'object' || typeof(_args[0]) == 'array' ) { _args = _args[0]; }
      if ( _busy ) {
        setTimeout( function(obj) {
          return function() {
            obj.load(args,_args);
          }
        }(this),100);
        return;
      }
      _busy = true;
      setTimeout( function() {
        if ( typeof(args) == 'function' ) { _on.Success = args; }
        else {
          _on = {};
          for (var i in args) { _on[i] = args[i]; }
        }
        var i = 0, j = _args.length;
        while ( i<j )
        {
          var m = _args[i];
          if ( _dependencies['phedex-'+m] ) { m = 'phedex-'+m; }
          _loader.require(m);
          i++;
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

    /** Returns a full list of modules loaded by this loader. This is the full list since the loader was instantiated, so will grow monotonically if the loader is used several times
    * @method loaded
    * @return {string}
    */
    loaded: function() { return _loader.inserted; },

    /** Return a list of PHEDEX modules known to the loader. Use this to determine the names of instantiatable data-display modules before they are loaded.
    * @method knownModules
    * @param all {boolean} Return all known modules. Defaults to <strong>false</strong>, which explicitly excludes dummy module(s) used for debugging
    * @return {array} List of all source-files matching <strong>/^phedex-module-/</strong>.
    */
    knownModules: function(all) {
      var km=[];
      for (var str in _dependencies) {
        if ( !all && str.match('^phedex-module-dummy') ) {
          continue;
        }
        if ( str.match('^phedex-module-(.+)$') ) {
          km.push(RegExp.$1);
        }
      }
      return km;
  },

    /** Useful for debugging, e.g. for building a menu of files to test loading them one by one
    * @method knownFiles
    * @return {array} a list of names known to the loader that it can be used to load.
    */
    knownObjects: function() {
      var o=[];
      for (var str in _dependencies) {
        o.push(str);
      }
      return o;
    }
  }
}
