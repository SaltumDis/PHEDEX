// Utility functions, not PhEDEx-specific, such as adding listeners for on-load etc.
PHEDEX.namespace('Util');

PHEDEX.Util.findOrCreateWidgetDiv = function(name)
{
// Find a div named 'name' and return it. If that div doesn't exist, create it, append it to a div called
// 'phedex_main', and then return it. This lets me create widgets in the top-level phedex_main div, on demand.
  YAHOO.log('Find or create '+name);
  var div = document.getElementById(name);
  if ( !div )
  {
    div = document.createElement('div');
    div.id = name;
    var phedex_main = document.getElementById('phedex_main');
    phedex_main.appendChild(div);
  }
  return div;
}

// not used. Creates a UL from an array of strings
PHEDEX.Util.makeUList = function(args) {
  var list = document.createElement('ul');
  for ( var i in args )
  {
    var li = document.createElement('li');
    li.innerHTML = args[i];
    list.appendChild(li);
  }
  return list;
}

// build a tree-node. Takes a Specification-object and a Value-object. Specification and Value are
// nominally identical, except values in the Value object can override the Specification object.
// This lets us create a template Specification and use it in several places (header, body) with
// different Values.
PHEDEX.Util.makeNode = function(spec,val) {
  if ( !val ) { val = {}; }
  var wtot = spec.width || 0;
  var list = document.createElement('ul');
  var div = document.createElement('div');
  list.className = 'inline_list';
  if ( wtot )
  {
    div.style.width = wtot+'px';
    var n = spec.format.length;
    for ( var i in spec.format )
    {
      if ( typeof(spec.format[i]) == 'object' )
      {
	var w_el = parseInt(spec.format[i].width);
	if ( w_el ) { wtot -= w_el; n--; }
      }
    }
  }
  var w = Math.round(wtot/n);
  if ( w < 0 ) { w=0; }
  for ( var i in spec.format )
  {
    var d1 = document.createElement('div');
    d1.innerHTML = ( val.length > 0 ? val[i] : spec.format[i].text);
    var w_el = parseInt(spec.format[i].width);
    if ( w_el ) {
      d1.style.width = w_el+'px';
    } else {
      if ( w ) { d1.style.width = w+'px'; }
    }
    if ( spec.className ) { d1.className = spec.className; }
    if ( spec.format[i].className ) {
      YAHOO.util.Dom.addClass(d1,spec.format[i].className);
    }
    if ( spec.format[i].otherClasses ) {
      var oc = spec.format[i].otherClasses.split(' ');
      for (var c in oc) { YAHOO.util.Dom.addClass(d1,oc[c]); }
    }
    var li = document.createElement('li');
    li.appendChild(d1);
    list.appendChild(li);
  }
  div.appendChild(list);
  return div;
}

// removed from PHEDEX.Core.Widget and placed here, for convenience
PHEDEX.Util.format={
    bytes:function(raw) {
      var f = parseFloat(raw);
      if (f>=1099511627776) return (f/1099511627776).toFixed(1)+' TB';
      if (f>=1073741824) return (f/1073741824).toFixed(1)+' GB';
      if (f>=1048576) return (f/1048576).toFixed(1)+' MB';
      if (f>=1024) return (f/1024).toFixed(1)+' KB';
      return f.toFixed(1)+' B';
    },
    '%':function(raw) {
      return (100*parseFloat(raw)).toFixed(2)+'%';
    },
    longString:function(raw) {
      return "<acronym title='"+raw+"'>"+raw+"</acronym>";
    },
    block:function(raw) {
      if (raw.length>50) {
        var short = raw.substring(0,50);
        return "<acronym title='"+raw+"'>"+short+"...</acronym>";
      } else {
        return raw;
      }
    },
    file:function(raw) {
      if (raw.length>50) {
        var short = raw.substring(0,50);
        return "<acronym title='"+raw+"'>"+short+"...</acronym>";
      } else {
        return raw;
      }
    },
    date:function(raw) {
      var d =new Date(parseFloat(raw)*1000);
      return d.toGMTString();
    },
    dataset:function(raw) {
      if (raw.length>50) {
        var short = raw.substring(0,50);
        return "<acronym title='"+raw+"'>"+short+"...</acronym>";
      } else {
        return raw;
      }
    },
    filesBytes:function(f,b) {
      var str = f+' files';
      if ( f > 0  ) { str += " / "+PHEDEX.Util.format.bytes(b); }
      return str;
    }
}

// for a given element, return the global configuration object defined for it. This allows to find configurations
// for elements created on the fly. If no configuration found, return a correct empty object, to avoid the need
// for messy nested existence checks in the client code
PHEDEX.Util.getConfig=function(element) {
  var config = PHEDEX.Page.Config.Elements[element];
  if ( config ) { return config; }
  config={};
  config.opts = {};
  return config;
}

// generate a new and page-unique name to use for a div for instantiating on-the-fly widgets
PHEDEX.Util.Sequence=function() {
  var me = arguments.callee;
  if ( ! me.value ) { me.value = 0; }
  return me.value++;
}

// generate a new and page-unique name to use for a div for instantiating on-the-fly widgets
PHEDEX.Util.generateDivName=function() {
  var j = ++PHEDEX.Page.Config.Count;
  return 'auto_Widget_'+j;
}

// Sum an array-field, with an optional parser to handle the field-format
PHEDEX.Util.sumArrayField=function(q,f,p) {
  var sum=0;
  if ( !p ) { p = parseInt; }
  for (var i in q) {
    sum+= p(q[i][f]);
  }
  return sum;
}


// This is for dynamically loading data into YUI TreeViews.
PHEDEX.Util.loadTreeNodeData=function(node, fnLoadComplete) {
// First, create a callback function that uses the payload to identify what to do with the returned data.
  var loadTreeNodeData_callback = function(result) {
    if ( result.stack ) {
      YAHOO.log('loadTreeNodeData: failed to get data','error','Core.TreeView');
    } else {
      node.payload.callback(node,result);
    }
    fnLoadComplete(); // Signal that the operation is complete, the tree can re-draw itself
  }

// Now, find out what to get, if anything...
  if ( typeof(node.payload) == 'undefined' )
  {
//  This need not be an error, so don't log it. Some branches are built on already-known data, and do not require new
//  data to be fetched. If dynamic loading is on for the whole tree this code will be hit for those branches.
    fnLoadComplete();
    return;
  }
  if ( node.payload.call )
  {
    if ( typeof(node.payload.call) == 'string' )
    {
//    payload calls which are strings are assumed to be Datasvc call names, so pick them up from the Datasvc namespace,
//    and conform to the calling specification for the data-service module
      YAHOO.log('in PHEDEX.Util.loadTreeNodeData for '+node.payload.call,'Core.TreeView');
      var query = [];
      query.api = node.payload.call;
      query.args = node.payload.args;
      query.callback = loadTreeNodeData_callback;
      PHEDEX.Datasvc.Call(query);
    }
    else
    {
//    The call-name isn't a string, assume it's a function and call it directly.
//    I'm guessing there may be a use for this, but I don't know what it is yet...
      YAHOO.log('Apparently require dynamically loaded data from a specified function. This code has not been tested yet','error','Core.Datasvc');
      node.payload.call(node,loadTreeNodeData_callback);
    }
  }
  else
  {
    YAHOO.log('Apparently require dynamically loaded data but do not know how to get it! (hint: payload probably malformed?)','warn');
    fnLoadComplete();
  }
}
