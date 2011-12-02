PHEDEX.namespace('Module');
PHEDEX.Module.StorageUsage = function(sandbox, string) {
  Yla(this,new PHEDEX.Protovis(sandbox,string));

  var _sbx = sandbox, se, level=3;
  log('Module: creating a genuine "'+string+'"','info',string);

   _construct = function(obj) {
    return {
      decorators: [
      ],
      options: {
        width:800,
        height:400,
        minwidth:600,
        minheight:50
      },
      meta: {
      },
      isValid: function() {
        if ( se ) { return true; }
        return false;
      },
      initMe: function() {
        var el = document.createElement('div');
        this.dom.content.appendChild(el);
        this.dom.treemap = el;
        el = document.createElement('div');
        el.style.clear = 'both';
        this.dom.content.appendChild(el);
        el = document.createElement('div');
        this.dom.content.appendChild(el);
        this.dom.stackedChart = el;

        this.selfHandler = function(o) {
          return function(ev,arr) {
            var action = arr[0],
                value = arr[1];
            switch (action) {
              case 'mouseover': {
                break;
              }
              case 'mouseout': {
                break;
              }
              case 'click': {
                break;
              }
              default: {
                break;
              }
            }
          }
        }(this);
        _sbx.listen(this.id,this.selfHandler);
      },
      getState: function() { return {se:se}; },
      initData: function() {
        this.dom.title.innerHTML = 'Waiting for parameters to be set...';
        if ( se ) {
          _sbx.notify( this.id, 'initData' );
          return;
        }
        _sbx.notify( 'module', 'needArguments', this.id );
      },
     setArgs: function(arr) {
        if ( !arr )          { return; }
        if ( !arr.se ) { return; }
        if ( arr.se == se ) { return; }
        se = arr.se;
        this.dom.title.innerHTML = 'setting parameters...';
        _sbx.notify(this.id,'setArgs');
      },
      getData: function() {
// customisable stuff starts here. Check that the 'se' is defined. If not, go ask for a value. If yes, get the data
        if ( !se ) {
          this.initData();
          return;
        }
        this.dom.title.innerHTML = 'fetching data...';
        log('Fetching data','info',this.me);
        _sbx.notify( this.id, 'getData', { api:'storageusage', args:{se:se,level:level} } );
      },
     gotData: function(data,context,response) {
        PHEDEX.Datasvc.throwIfError(data,response);
        log('Got new data','info',this.me);
        this.dom.title.innerHTML = 'Parsing data';

        if ( !data.nodes ) {
          throw new Error('data incomplete for '+context.api);
        }

//         this.makeStackChart(data);
        this.makeTreemap(data);
      },
      makeStackChart: function(data) {
        var w = 400,
            h = 200,
            x = pv.Scale.linear(0, 9.9).range(0, w),
            y = pv.Scale.linear(0, 14).range(0, h);

        data = pv.range(4).map(function() {
          return pv.range(0, 10, .1).map(function(x) {
              return {x: x, y: Math.sin(x) + Math.random() * .5 + 2};
            });
        });

/* The root panel. */
        var vis = new pv.Panel()
            .canvas(this.dom.stackedChart)
            .width(w)
            .height(h)
            .bottom(20)
            .left(20)
            .right(10)
            .top(5);

/* X-axis and ticks. */
        vis.add(pv.Rule)
            .data(x.ticks())
            .visible(function(d) { return d;})
            .left(x)
            .bottom(-5)
            .height(5)
          .anchor('bottom').add(pv.Label)
            .text(x.tickFormat);

/* The stack layout. */
        vis.add(pv.Layout.Stack)
            .layers(data)
            .x(function(d) { return x(d.x); })
            .y(function(d) { return y(d.y); })
          .layer.add(pv.Area);

/* Y-axis and ticks. */
        vis.add(pv.Rule)
            .data(y.ticks(3))
            .bottom(y)
            .strokeStyle(function(d) { return d ? 'rgba(128,128,128,.2)' : '#000'; })
          .anchor('left').add(pv.Label)
            .text(y.tickFormat);

        vis.render();
      },
      makeTreemap: function(data) {
        var max=0, tmp={}, tree={}, i, j, k, _level, item, node, timebins, timebin, total=0, path;
// parse the data into the pvData structure.
        for ( i in data.nodes ) {
          node = data.nodes[i];
          timebin = node.timebins[0];
          this.dom.title.innerHTML = 'Node: '+se+' Root: "'+node.subdir+'" level:'+level+' Time: '+PxUf.UnixEpochToUTC(timebin.timestamp);
          for ( j in timebin.levels ) {
            _level = timebin.levels[j];
            if ( _level.level == level ) {
              for ( k in _level.data ) {
                item = _level.data[k];
                tmp[item.dir] = item.size;
                total += item.size
              }
            }
          }
        }

// coalesce tiny entries
        j = 0;
        for ( i in tmp ) {
          if ( tmp[i]/total < 0.01 ) {
            j += tmp[i];
            delete tmp[i];
          }
        }
        if ( j ) { tree['other'] = j; } // yes, 'tree', not 'tmp'!
        for ( i in tmp ) {
          path = i.split('/');
          path.shift();
          k = tree;
          for ( j in path ) {
            if ( parseInt(j)+1 == path.length ) {
              k[i] = tmp[i];
            } else {
              if ( !k[path[j]] ) { k[path[j]] = {}; }
              k = k[path[j]];
            }
          }
        }

//      base options for the canvas. Take some from the module definition, others from the data, etc.
        max = max * 1.5;
        var w = this.options.width,
            h = this.options.height;

/* The root panel. */
        var vis = new pv.Panel()
            .canvas(this.dom.treemap)
            .width(w)
            .height(h)
            .bottom(20)
            .left(20)
            .right(10)
            .top(5);

        function title(d) { return d.parentNode ? (title(d.parentNode) + '/' + d.nodeName) : ''; }

        var re = '',
            color = pv.Colors.category20().by(function(d) { return title(d.parentNode); }),
            nodes = pv.dom(tree).root('tree').nodes();

        var treemap = vis.add(pv.Layout.Treemap)
            .nodes(nodes)
            .round(true);

        treemap.leaf.add(pv.Panel)
            .fillStyle(function(d) { return color(d).alpha(title(d).match(re) ? 1 : .2); } )
            .strokeStyle('#fff')
            .lineWidth(1)
            .antialias(false);

        treemap.label.add(pv.Label)
            .textStyle(function(d) { return pv.rgb(0, 0, 0, title(d).match(re) ? 1 : .2); } );

//         treemap.event('mouseover',this.callback('mouseover') )
//                .event('mouseout', this.callback('mouseout') )
//                .event('click',    this.callback('click') );
        vis.render();
        this.visTreemap = vis;
      },
      callback: function(event) {
        var args = [obj.id, event];
        return function() {
          var _args = Array.apply(null,args);
          _args.push(this);
          _args.push(obj.visTreemap);
          PxS.notify.apply(PxS,_args);
        }
      },
    };
  };
  Yla(this,_construct(this),true);
  return this;
};
log('loaded...','info','storageusage');
