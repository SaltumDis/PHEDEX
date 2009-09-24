// A PhEDEx base-class and global definitions?

PHEDEX= {}
PHEDEX.Appserv = {};
PHEDEX.Appserv.Version = '0.0.2';

// shamelessly cribbed from PHEDEX. For more information, see
// http://yuiblog.com/blog/2007/06/12/module-pattern/
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

PHEDEX.namespace('Base');
PHEDEX.Base.Object = function() {
  return {
//  onHideFilter: new YAHOO.util.CustomEvent("onHideFilter", this, false, YAHOO.util.CustomEvent.LIST),
    dom: [],
    ctl: [],
    options: {},
    me: function() { YAHOO.log('unimplemented "me"','error','undefined'); return 'undefined'; },
  };
}
