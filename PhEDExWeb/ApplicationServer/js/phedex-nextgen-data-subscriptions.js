PHEDEX.namespace('Nextgen.Data');
PHEDEX.Nextgen.Data.Subscriptions = function(sandbox) {
  var string = 'nextgen-data-subscriptions',
      _sbx = sandbox,
      NUtil = PHEDEX.Nextgen.Util,
      Dom = YAHOO.util.Dom,
      Event = YAHOO.util.Event,
      Yw = YAHOO.widget,
      Button = Yw.Button;
  Yla(this,new PHEDEX.Module(_sbx,string));

  log('Nextgen: creating a genuine "'+string+'"','info',string);

  _construct = function(obj) {
    return {
      options: {
        width:500,
        height:200,
        minwidth:600,
        minheight:50
      },
      _default:{}, // default values for various DOM fields, extracted as they are built
      _filter: { node:[], request:[], data:[] }, // values set by the filter tab, updated as they are changed
      meta: {
        showColumns:
        [
          {label:'Request',       _default:true},
          {label:'Data Level',    _default:true},
          {label:'Data Item',     _default:true},
          {label:'Node',          _default:true},
          {label:'Priority',      _default:true},
          {label:'Custodial',     _default:true},
          {label:'Group',         _default:true},
          {label:'Node Files',    _default:true},
          {label:'Node Bytes',    _default:true},
          {label:'% Files',       _default:false},
          {label:'% Bytes',       _default:true},
          {label:'Replica/Move',  _default:true},
          {label:'Suspended',     _default:true},
          {label:'Open',          _default:false},
          {label:'Time Create',   _default:true},
//           {label:'Time Complete', _default:false},
          {label:'Time Done',     _default:false}
        ],
        map:
        {
          custodial:{custodial:'y', 'non-custodial':'n'},
          suspended:{suspended:'y', active:'n'},
          create_since:{forever:0, '2 years':24, '1 year':12, '6 months':6}, // months...
        },
        filterMap:
        {
          fields:
          {
             custodiality:      'custodial',
            'active/suspended': 'suspended',
             priority:          'priority',
             group:             'group'
          },
          values:
          {
            custodial:{custodial:'y', 'non-custodial':'n'},
            suspended:{suspended:'y', active:'n'},
           'created since':{forever:0, '2 years':24, '1 year':12, '6 months':6} // months...
          },
        }
      },
      useElement: function(el) {
        var d = this.dom, form;
        d.target = el;
        d.container  = document.createElement('div'); d.container.className  = 'phedex-nextgen-container'; d.container.id = 'doc3';
        d.hd         = document.createElement('div'); d.hd.className         = 'phedex-nextgen-hd';        d.hd.id = 'hd';
        d.bd         = document.createElement('div'); d.bd.className         = 'phedex-nextgen-bd';        d.bd.id = 'bd';
        d.ft         = document.createElement('div'); d.ft.className         = 'phedex-nextgen-ft';        d.ft.id = 'ft';
        d.main       = document.createElement('div'); d.main.className       = 'yui-main';
        d.main_block = document.createElement('div'); d.main_block.className = 'yui-b phedex-nextgen-main-block';
        d.selector   = document.createElement('div'); d.selector.id          = 'phedex-data-subscriptions-selector';
        d.dataform   = document.createElement('div'); d.dataform.id          = 'phedex-data-subscriptions-dataform';
        d.messages   = document.createElement('div'); d.messages.id          = 'phedex-data-subscriptions-messages';
        d.datatable  = document.createElement('div'); d.datatable.id         = 'phedex-data-subscriptions-datatable';
        form = document.createElement('form');
        form.id   = 'data-subscriptions-action';
        form.name = 'data-subscriptions-action';
        form.method = 'post';
        form.action = location.pathname;
        this.data_subscriptions_action = form;

        d.bd.appendChild(d.main);
        d.main.appendChild(d.main_block);
        d.container.appendChild(d.hd);
        d.container.appendChild(d.bd);
        d.container.appendChild(d.ft);
        d.container.appendChild(d.selector);
        d.container.appendChild(d.dataform);
        d.dataform.appendChild(form);
        d.dataform.appendChild(d.messages);
        d.dataform.appendChild(d.datatable);
        el.innerHTML = '';
        el.appendChild(d.container);

        d.floating_help = document.createElement('div'); d.floating_help.className = 'phedex-nextgen-floating-help phedex-invisible'; d.floating_help.id = 'phedex-help-'+PxU.Sequence();
        document.body.appendChild(d.floating_help);
      },
      gotAuthData: function(data,context,response) {
        PHEDEX.Datasvc.throwIfError(data,response);
        if ( !data.auth ) { return; }
        var auth, roles, role, i;
        if ( typeof(auth) != 'object' ) { auth = {}; } // AUTH call failed, proceed regardless...

        obj.auth = auth = data.auth[0];
        auth.isAdmin = false;
        auth.can = [];
        roles = auth.role;
        for ( i in roles ) {
          role = roles[i];
          if ( ( role.name == 'Admin' && role.group == 'phedex' ) ||
               ( role.name == 'PADA Admin'   ) ||
               ( role.name == 'Data Manager' ) ||
               ( role.name == 'Site Admin'   ) ) {
            auth.can.push('suspend');
            auth.isAdmin = true;
          }
          if ( ( role.name == 'Admin' && role.group == 'phedex' ) ||
               ( role.name == 'Data Manager' ) ) {
            auth.can.push('priority');
          }

        }
        if (  auth.isAdmin ) { _sbx.notify(obj.id,'isAdmin'); }
        if ( !auth.isAdmin ) { _sbx.notify(obj.id,'isNotAdmin'); }
      },
      isNotAdmin: function() {
//      User has no administrative rights. Add a link explaining why.
        var el = document.createElement('a'),
            auth = obj.auth,
            d=obj.dom, container=d.container,
            toggle, id=PxU.Sequence();
        el.id = 'phedex-help-anchor-'+id;
        el.href = '#';
        el.innerHTML = 'Privileged Activities Help';
        container.appendChild(el);
        toggle = "var s = new PHEDEX.Sandbox(); s.notify('"+obj.id+"','Help','privilegedActivity');";
        obj.privilegedActivity = {
            text: "<a id='close-anchor-"+id+"' class='float-right' href='#'>[close]</a>" +
                  "<p><strong>Privileged Activities:</strong></p>" +
                  NUtil.authHelpMessage(
                    { to:'change priorities of subscriptions and manage groups', need:'cert', role:['Data Manager', 'Admin'] },
                    { to:'suspend/unsuspend subscriptions',                      need:'any',  role:['Data Manager', 'Site Admin', 'PADA Admin', 'Admin'] }
                  ),
            el:el,
            close:'close-anchor-'+id,
            toggle:toggle
          };
        el.setAttribute('onclick',toggle);
        return;
      },
      isAdmin: function() {
//     User has administrative rights, add the menus!
        var auth=obj.auth,
            i, j, k, d=obj.dom, container=d.container, selector=d.selector, form=obj.data_subscriptions_action,
            id=PxU.Sequence(),
            field, el, button,
            admin_opts = {
                   suspend:     'Suspend subscriptions',
                   unsuspend:   'Unsuspend subscriptions',
                   priorityhi:  'Make high priority',
                   prioritymd:  'Make normal priority',
                   prioritylo:  'Make low priority',
                   groupchange: 'Change group'
                 },
            admin_grps = {
                   'suspend':['suspend', 'unsuspend'],
                   'priority':['priorityhi', 'prioritymd', 'prioritylo', 'groupchange']
                 },
            admin_menu=[];
        for ( i in auth.can ) {
          j=admin_grps[auth.can[i]];
          for ( k in j ) { admin_menu.push({ value:j[k], text:admin_opts[j[k]] }); }
        }
        if ( admin_menu.length ) {
          el=document.createElement('div');
          el.innerHTML = "<div class='phedex-data-subscriptions-action'>" +
                           "<span class='phedex-nextgen-label' id='phedex-data-subscriptions-label-select'>Selections:</span>" +
                           "<span id='phedex-data-subscriptions-ctl-select-all'></span>" +
                           "<span id='phedex-data-subscriptions-ctl-clear-all'></span>" +
                         "</div>";
          selector.appendChild(el);
          var onSelectAllOrNone = function(val) {
            return function(obj) {
              return function() {
                var elList;
debugger; // TW have to find the 'select' column and act on it... Better build the table first :-)
              }
            }(this);
          };
          button = new Button({ label:'Select all',  id:'phedex-data-subscriptions-select-all',  container:'phedex-data-subscriptions-ctl-select-all'  });
          button.on('click',onSelectAllOrNone(1));
          button = new Button({ label:'Clear all', id:'phedex-data-subscriptions-clear-all', container:'phedex-data-subscriptions-ctl-clear-all' });
          button.on('click',onSelectAllOrNone(0));

          i = document.createElement('input');
          i.type = 'hidden'
          i.name = 'priority';
          i.value = this.params.priority;
          form.appendChild(i);
          i = document.createElement('input');
          i.type = 'hidden'
          i.name = 'suspended';
          i.value = this.params.suspended;
          form.appendChild(i);

          field='action';
          el = document.createElement('span');
          el.id = 'phedex-subscription-action-'+id;
          el.innerHTML = "<div class='phedex-data-subscriptions-action'>" +
                           "<span class='phedex-nextgen-label' id='phedex-data-subscriptions-label-action'>Action:</span>" +
                           "<span id='phedex-data-subscriptions-ctl-action'></span>" +
                           "<span id='phedex-data-subscriptions-ctl-group' 'class='phedex-invisible'><em>loading group menu</em></span>" +
                           "<span id='phedex-data-subscriptions-ctl-update'></span>" +
                         "</div>";
          form.appendChild(el);
          this.ctl[field] = button = new Button({
            id:          'phedex-data-subscriptions-action',
            name:        'phedex-data-subscriptions-action',
            label:       'Choose an action',
            type:        'menu',
            lazyloadmenu: false,
            menu:         admin_menu,
            container:   'phedex-data-subscriptions-ctl-action'
          });
          button.on('selectedMenuItemChange', this.onSelectedMenuItemChange(field));
          this._default[field] = function(_button,_field,index) {
            return function() { _button.set('selectedMenuItem',_button.getMenu().getItem(index||0)); };
          }(button,field,0);
          this.onUpdate = function() {
            var elList, action, param;
debugger; // TW have to find the 'select' column and act on it... Better build the table first :-)
            action = this.ctl.action;
          };
          button = new Button({ label:'Apply changes',  id:'phedex-data-subscriptions-update',  container:'phedex-data-subscriptions-ctl-update'  });
          button.on('click',this.onUpdate);
        }
      },
      Help:function(item) {
        item = this[item];
        var elRegion = Dom.getRegion(item.el),
            elHelp   = this.dom.floating_help;
        elHelp.innerHTML = item.text;
        if ( Dom.hasClass(elHelp,'phedex-invisible') ) {
          Dom.removeClass(elHelp,'phedex-invisible');
          Dom.setX(elHelp,elRegion.right+10);
          Dom.setY(elHelp,elRegion.top);
        } else {
          Dom.addClass(elHelp,'phedex-invisible');
        }
        if ( item.close && item.toggle ) {
          Dom.get(item.close).setAttribute('onclick',item.toggle);
        }
      },
      init: function(params) {
        var i, hideThese=[], columns=this.meta.showColumns;
        if ( !params ) { params={}; }
        this.params = params;
        this.useElement(params.el);
        var selfHandler = function(obj) {
          return function(ev,arr) {
            var action=arr[0], i, value, field, _filter, filterMap, _filterField;
            if ( obj[action] && typeof(obj[action]) == 'function' ) {
              arr.shift();
              obj[action].apply(obj,arr);
              return;
            }
            _filter = obj._filter;
            filterMap = obj.meta.filterMap;
            switch (action) {
              case 'Reset-filters': {
                for ( i in obj._default ) { obj._default[i](); }
                break;
              }
              case 'menuChange_action': {
                if ( arr[2] == 'Change group' ) {
                  obj.ctl.group.set('disabled',false);
                } else {
                  obj.ctl.group.set('disabled',true);
                }
                break;
              }
              case 'menuChange_group': {
                if ( arr[2] == 'any' ) {
                  delete _filter.group;
                } else {
                  _filter.group = arr[2];
                }
                break;
              }
              case 'menuChange_filter': {
                field = filterMap.fields[arr[1]];
                if ( field ) {
                  if ( arr[2] == 'any' ) {
                    delete _filter[field];
                  } else {
                    _filterField = filterMap.values[field];
                    if ( _filterField ) { _filter[field] = _filterField[arr[2]]; }
                    else                { _filter[field] = arr[2]; }
                    if ( _filter[field] == null ) { delete _filter[field]; }
                  }
                  break;
                }

//              special cases
                if ( arr[1] == 'completion' ) {
                  delete _filter.percent_min;
                  delete _filter.percent_max;
                  if ( arr[2] == 'complete' )   { _filter.percent_min=100; }
                  if ( arr[2] == 'incomplete' ) { _filter.percent_max=99.99999; }
                  break;
                }
// another special case. Note the finesse here, create_since=0 is valid, means forever, and does not enter this code
                if ( arr[1] == 'created since' ) {
                  i = filterMap.values[arr[1]][arr[2]];
                  if ( i ) {
                    _filter.create_since = new Date().getTime()/1000 - filterMap.values[arr[1]][arr[2]]*86400*30;
                  } else {
                    _filter.create_since = 0;
                  }
                }
                break;
              }
              case 'SelectAllNodes': {
                obj._filter.node = obj.nodePanel.nodes;
                break;
              }
              case 'DeselectAllNodes': {
                obj._filter.node = [];
                break;
              }
              case 'NodeSelected': {
                var i, nodes=obj._filter.node;
                for (i in nodes) {
                  if ( nodes[i] == arr[1] ) {
                    if ( arr[2] ) { break; }
                    nodes.splice(i,1);
                    break;
                  }
                }
                if ( arr[2] ) {
                  nodes.push(arr[1]);
                }
                break;
              }
              case 'CBoxPanel-selected': {
                var label=arr[1], show=arr[2];
                _sbx.notify(obj.subscriptionsId,'setColumnVisibility',[ {label:label,show:show} ]);
                break;
              }
              case 'DoneSelectAll-columns':   // deliberate fall-through
              case 'DoneDeselectAll-columns': // deliberate fall-through
              case 'DoneReset-columns': {
                obj.setHiddenColumns();
                break;
              }
              default: {
                break;
              }
            }
          }
        }(this);
        _sbx.listen(this.id, selfHandler);
        this.initFilters();
        this.initSub();
        PHEDEX.Datasvc.Call({ method:'post', api:'auth', callback:this.gotAuthData })
        PHEDEX.Datasvc.Call({ api:'groups', callback:this.gotGroupMenu });

        _sbx.notify('SetModuleConfig','subscriptions-table', { parent:this.dom.datatable, autoDestruct:false, noDecorators:true, noExtraDecorators:true, noHeader:true });
        _sbx.notify('CreateModule','subscriptions-table',{notify:{who:this.id, what:'gotSubscriptionsId'}});
        this.getSubscriptions();
        _sbx.notify(this.id,'buildOptionsTabview');
      },
      setHiddenColumns: function() {
        var el, elList=this.columnPanel.elList, i, columns=[];
        for ( i in elList ) {
          el = elList[i];
          columns.push({label:el.name, show:el.checked});
        }
        _sbx.notify(obj.subscriptionsId,'setColumnVisibility',columns);
      },
      gotSubscriptionsId: function(arg) {
        this.subscriptionsId = arg;
        var handler = function(obj) {
          return function(ev,arr) {
            var action = arr[0], arr1;
            switch (action) {
              case 'setSummary': {
                arr1 = arr.slice();
                arr1.shift();
                obj.setSummary.apply(obj,arr1);
                break;
              }
              case 'destroy': {
                delete this.previewId;
                break;
              }
              case 'initDerived': { // module is live, set the hidden fields!
                obj.subscriptionsModuleIsReady = true;
                obj.setHiddenColumns();
                break;
              }
            }
          }
        }(this);
        _sbx.listen(this.subscriptionsId,handler);
      },
      getSubscriptions: function() {
        var args = {collapse:'y', create_since:6*30*86400 /* months */}, i, filter=this._filter, f, map=this.meta.map;
        for (i in filter) {
          f = filter[i];
          if ( typeof(f) == 'array' || typeof(f) == 'object' ) {
            if ( f.length ) {
              args[i] = f;
            }
          } else {
            args[i] = f;
          }
        }
        this.dom.messages.innerHTML = PxU.stdLoading('loading subscriptions data...');
        PHEDEX.Datasvc.Call({
                              api:'subscriptions',
                              args:args,
                              callback:function(data,context,response) { obj.gotSubscriptions(data,context,response); }
                            });
      },
      gotSubscriptions:function(data,context,response) {
        PHEDEX.Datasvc.throwIfError(data,response);
        var datasets=data.dataset, api=context.api, i, j, k, dataset, blocks, block, table, row,
            d=obj.dom, level;

        if ( response ) {
          this.setSummary('error',"Error retrieving subscriptions data");
          return;
        }
        switch (api) {
          case 'subscriptions': {
            if ( !this.subscriptionsId ) {
              _sbx.delay(25,'module','*','lookingForA',{moduleClass:'subscriptions-table', callerId:this.id, callback:'gotSubscriptionsId'});
              _sbx.delay(50, this.id, 'gotSubscriptions',data,context,response);
              return;
            }
            if ( !this.subscriptionsModuleIsReady ) {
              _sbx.delay(50, this.id, 'gotSubscriptions',data,context,response);
              return;
            }
            _sbx.notify(this.subscriptionsId,'doGotData',data,context,response);
            d.messages.innerHTML = '';
            Dom.removeClass(d.messages,'phedex-invisible');
            if ( !datasets || !datasets.length ) {
              d.messages.innerHTML = "<span class='phedex-box-red' style='padding:5px;'>No data found matching your query!</span>";
              d.messages.style.margin = '5px 0';
              return;
            }
            d.messages.innerHTML = d.messages.style.margin = '';
            for (i in datasets) {
              dataset = datasets[i];
              row=[];
              if ( dataset.subscription ) { level = 'DATASET'; }
            }
            break;
          }
        }
      },
      initFilters: function() {
        var p=this.params, i, j, requests, columns, col, label,
            _default =
              {
                item:      '.*',
                priority:  'any',
                suspended: 'any',
                custodial: 'any',
                group:     'any'
              };
        for ( i in _default ) {
          if ( !p[i] ) { p[i] = _default[i]; }
        }

        if ( p.requests ) {
          requests = p.requests.split(/(\s*,*\s+|\s*,+\s*)/);
          p.requests = [];
          for ( i in requests ) {
            if ( requests[i].match(/^\d+$/) ) {
              p.requests.push(requests[i]);
            }
          }
        } else {
          p.requests = [];
        }

        columns = this.meta.showColumns;
        if ( p.col ) {
          if ( typeof(p.col) != 'object'  ) {
            p.col = [ p.col ];
          }
          for ( i in p.col ) {
            label = p.col[i];
            for (j in columns) {
              col = columns[j];
              if ( col.label == label ) {
                col.checked = true;
                continue;
              }
            }
          }
        }

        if ( p.node ) {
          if ( typeof(p.node) != 'object' ) {
            p.node = [ p.node ];
          }
// TW Still need to do something with the nodes!
        }
      },
      initSub: function() {
        var d=this.dom, mb=d.main_block, el, b, ctl=this.ctl, id='image-'+PxU.Sequence(), container=d.container;
        el = document.createElement('div');
        el.innerHTML = "<div id='phedex-options-control'></div>" +
                       "<div id='phedex-data-subscriptions-options-panel' class='phedex-invisible'></div>";
        mb.appendChild(el);
        ctl.options = {
            panel:Dom.get('phedex-data-subscriptions-options-panel'),
            label_show:"<img id='"+id+"' src='"+PxW.WebAppURL+"/images/icon-wedge-green-down.png' style='vertical-align:top'>Show options",
            label_hide:"<img id='"+id+"' src='"+PxW.WebAppURL+"/images/icon-wedge-green-up.png'   style='vertical-align:top'>Hide options",
          };
        ctl.options.button = b = new Button({
                                          label:ctl.options.label_show,
                                          id:'phedex-options-control-button',
                                          container:'phedex-options-control' });
        var onShowOptionsClick = function(obj) {
          return function() {
            var ctl=obj.ctl, opts=ctl.options, apply=obj.dom.apply;
            if ( Dom.hasClass(opts.panel,'phedex-invisible') ) {
              Dom.removeClass(opts.panel,'phedex-invisible');
              if ( apply ) { Dom.removeClass(apply,'phedex-invisible'); }
              opts.button.set('label',opts.label_hide);
            } else {
              Dom.addClass(opts.panel,'phedex-invisible');
              if ( apply ) { Dom.addClass(apply,'phedex-invisible'); }
              opts.button.set('label',opts.label_show);
            }
            if ( !opts.tabView ) { obj.buildOptionsTabview(); }
          }
        }(this);
        b.on('click',onShowOptionsClick);
      },
      buildOptionsTabview: function() {
        var d=this.dom, ctl = this.ctl, mb=d.main_block, form, el, elBlur,
            opts=ctl.options, tab, tabView, SelectAll, DeselectAll, Reset, Apply, apply=this.dom.apply;
        if ( opts.tabview ) { return; }
        form = document.createElement('form');
        form.id   = 'data-subscriptions-filter';
        form.name = 'data-subscriptions-filter';
        form.method = 'get';
        this.data_subscriptions_filter = form;
        opts.panel.appendChild(form);
        tabView = opts.tabView = new Yw.TabView();
        tab = new Yw.Tab({
          label: 'Show/hide Columns',
          content:
                "<div id='phedex-columnpanel-container' class='phedex-nextgen-form-element'>" +
                  "<div id='phedex-columnlabel' class='phedex-nextgen-label'>" +
                    "<div class='phedex-vertical-buttons' id='phedex-selectall-columns'></div>" +
                    "<div class='phedex-vertical-buttons' id='phedex-deselectall-columns'></div>" +
                    "<div class='phedex-vertical-buttons' id='phedex-reset-columns'></div>" +
                  "</div>" +
                  "<div id='phedex-columnpanel' class='phedex-nextgen-control phedex-nextgen-nodepanel'>" +
                  "</div>" +
                "</div>",
          active: true
        });
        tabView.addTab(tab);
        SelectAll   = new Button({ label:'Select all',   id:'selectallcolumns',   container:'phedex-selectall-columns' });
        SelectAll.on(  'click', function(obj) { return function() { _sbx.notify(obj.id,'SelectAll-columns'); } }(this) );
        DeselectAll = new Button({ label:'Clear all', id:'deselectallcolumns', container:'phedex-deselectall-columns' });
        DeselectAll.on('click', function(obj) { return function() { _sbx.notify(obj.id,'DeselectAll-columns'); } }(this) );
        Reset       = new Button({ label:'Reset to defaults', id:'resetcolumns', container:'phedex-reset-columns' });
        Reset.on(      'click', function(obj) { return function() { _sbx.notify(obj.id,'Reset-columns'); } }(this) );

        SelectAll   = new Button({ label:'Select all Nodes',   id:'selectallnodes',   container:'phedex-selectall-nodes' });
        SelectAll.on(  'click', function(obj) { return function() { _sbx.notify(obj.id,'SelectAllNodes'); } }(this) );
        DeselectAll = new Button({ label:'Clear all Nodes', id:'deselectallnodes', container:'phedex-deselectall-nodes' });
        DeselectAll.on('click', function(obj) { return function() { _sbx.notify(obj.id,'DeselectAllNodes'); } }(this) );

        tab = new Yw.Tab({
          label: 'Select Data',
          content:
                "<div id='phedex-filterpanel-container' class='phedex-nextgen-filterpanel'>" +
                  "<div id='phedex-filterlabel' class='phedex-nextgen-label float-left'>" +
                  "</div>" +
                  "<div id='phedex-filterpanel' /*class='phedex-nextgen-control'*/>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-nodes'>" +
                      "<div class='phedex-nextgen-label' id='phedex-label-node'>"+
                        "<div class='phedex-vertical-buttons' id='phedex-selectall-nodes'></div>" +
                        "<div class='phedex-vertical-buttons' id='phedex-deselectall-nodes'></div>" +
                      "</div>" +
                      "<div id='phedex-data-subscriptions-nodepanel-wrapper'>" +
                        "<div class='phedex-nextgen-nodepanel' id='phedex-nodepanel'>" +
                          "<em>loading node list...</em>" +
                        "</div>" +
                      "</div>" +
                    "</div>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-requests'>requests</div>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-dataitems'>data items</div>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-custodial'>custodiality</div>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-group'>group</div>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-active'>active/suspended</div>" +
                    "<div class='phedex-clear-both' id='phedex-filterpanel-priority'>priority</div>" +
                    "<div id='phedex-filterpanel-completion'>completion</div>" +
                    "<div id='phedex-filterpanel-create-since'>created since</div>" +
                  "</div>" +
                "</div>" +
                "<div id='phedex-data-subscriptions-apply-filters'>" +
                "</div>"
        });
        tabView.addTab(tab);
        Apply = new Button({ label:'Apply', id:'apply', container:'phedex-data-subscriptions-apply-filters' });
        Apply.on('click', function(obj) { return function() { _sbx.notify(obj.id,'getSubscriptions'); } }(this) );

        tabView.appendTo(form); // need to attach elements to DOM before further manipulation

// for the Filter tab
        var field, Field; // oh boy, I'm asking for trouble here...
// Requests
        el = Dom.get('phedex-filterpanel-requests');
        field=el.innerHTML; Field=PxU.initialCaps(field); // oh boy, I'm asking for trouble here...
        el.innerHTML = "<div class='phedex-nextgen-filter-element-x'>" +
                  "<div class='phedex-nextgen-label' id='phedex-label-"+field+"'>"+Field+":</div>" +
                  "<div class='phedex-nextgen-filter'>" +
                    "<div id='phedex-nextgen-filter-resize-"+field+"'><textarea id='phedex-data-subscriptions-input-"+field+"' name='"+field+"' class='phedex-filter-inputbox'>" + "List of request-IDs" + "</textarea></div>" +
                  "</div>" +
                "</div>";
        d[field] = el = Dom.get('phedex-data-subscriptions-input-'+field);
        this._default[field] = function(e,t) {
          return function() { e.value=t; Dom.setStyle(e,'color','grey'); }
        }(el,el.value);
        Dom.setStyle(el,'color','grey')
        el.onfocus=function(obj,text) {
          return function() {
            if ( this.value == text ) {
              this.value = '';
              Dom.setStyle(this,'color','black');
            }
          }
        }(this,el.value);
        elBlur = function(obj,field,text) {
          return function() {
            var value = this.value;
            value = value.replace(/\n|,/g,' ');
            if ( value.match(/^ *$/) ) {
              this.value = text;
              Dom.setStyle(this,'color','grey')
              obj._filter[field] = [];
            } else {
              obj._filter[field]  = value.split(/ |\n|,/);
            }
          }
        };
        el.onblur=elBlur(this,'request',el.value);
        NUtil.makeResizable('phedex-nextgen-filter-resize-'+field,'phedex-data-subscriptions-input-'+field,{maxWidth:1000, minWidth:100});

// Data items
        el = Dom.get('phedex-filterpanel-dataitems');
        field=el.innerHTML; Field=PxU.initialCaps(field);
        field = field.replace(/ /,'');
        el.innerHTML = "<div class='phedex-nextgen-filter-element'>" +
                  "<div class='phedex-nextgen-label' id='phedex-label-"+field+"'>"+Field+":</div>" +
                  "<div class='phedex-nextgen-filter'>" +
                    "<div id='phedex-nextgen-filter-resize-"+field+"'><textarea id='phedex-data-subscriptions-input-"+field+"' name='"+field+"' class='phedex-filter-inputbox'>" + "Block name or Perl reg-ex" + "</textarea></div>" +
                  "</div>" +
                "</div>";
        d[field] = el = Dom.get('phedex-data-subscriptions-input-'+field);
        this._default[field] = function(e,t) {
          return function() { e.value=t; Dom.setStyle(e,'color','grey'); }
        }(el,el.value);
        Dom.setStyle(el,'color','grey')
        el.onfocus=function(obj,text) {
          return function() {
            if ( this.value == text ) {
              this.value = '';
              Dom.setStyle(this,'color','black');
            }
          }
        }(this,el.value);
        el.onblur=elBlur(this,'data',el.value);
        NUtil.makeResizable('phedex-nextgen-filter-resize-'+field,'phedex-data-subscriptions-input-'+field,{maxWidth:1000, minWidth:100});

// Generic for all buttons...
        var menu, button;
        this.onSelectedMenuItemChange = function(_field,action) {
              if ( !action ) { action = _field; }
              return function(event) {
                var oMenuItem = event.newValue,
                    text = oMenuItem.cfg.getProperty('text'),
                    value = oMenuItem.value,
                    previous;
                if ( event.prevValue ) { previous = event.prevValue.value; }
                if ( value == previous ) { return; }
                  this.set('label', text);
                _sbx.notify(obj.id,'menuChange_'+action,_field,text);
              };
            }

// Priority...
        menu = [
          { text: 'any',    value: 'any' },
          { text: 'low',    value: 'low' },
          { text: 'normal', value: 'normal' },
          { text: 'high',   value: 'high' }
        ];
        this.filterButton('phedex-filterpanel-priority',menu);

// Active/Suspended...
        menu = [
          { text: 'any',       value: 'any' },
          { text: 'active',    value: 'active' },
          { text: 'suspended', value: 'suspended' }
        ];
        this.filterButton('phedex-filterpanel-active',menu);

// Custodial - dropdown (inc 'any')
        menu = [
          { text: 'any',           value: 'any' },
          { text: 'custodial',     value: 'custodial' },
          { text: 'non-custodial', value: 'non-custodial' }
        ];
        this.filterButton('phedex-filterpanel-custodial',menu);

// Group - dropdown (inc 'any')
        el = Dom.get('phedex-filterpanel-group');
        field=el.innerHTML; Field=PxU.initialCaps(field);
        el.innerHTML = "<div class='phedex-nextgen-filter-element'>" +
                        "<div class='phedex-nextgen-label' id='phedex-label-"+field+"'>"+Field+":</div>" +
                        "<div class='phedex-nextgen-filter'>" +
                          "<div id='phedex-filterpanel-ctl-"+field+"'>" +
                            "<em>loading group list...</em>" +
                          "</div>" +
                        "</div>" +
                      "</div>";

// Completion - dropdown (inc 'any')
        menu = [
          { text: 'any',        value: 'any' },
          { text: 'complete',   value: 'complete' },
          { text: 'incomplete', value: 'incomplete' }
        ];
        this.filterButton('phedex-filterpanel-completion',menu);

// Created-since - dropdown
        var m=this.meta.map.create_since, i;
        menu=[];
        for (i in m) {
          menu.push({text:i, value:m[i]});
        }
        this.filterButton('phedex-filterpanel-create-since',menu,menu.length-1);

// for the Node tab...
        this.nodePanel = NUtil.NodePanel( this, Dom.get('phedex-nodepanel') );
        NUtil.makeResizable('phedex-data-subscriptions-nodepanel-wrapper','phedex-nodepanel',{maxWidth:1000, minWidth:100});

// for the Columns tab...
        this.columnPanel = NUtil.CBoxPanel( this, Dom.get('phedex-columnpanel'), { items:this.meta.showColumns, name:'columns' } );
      },
      filterButton: function(el,menu,_default) {
        var id=PxU.Sequence(), field, Field;
        if ( !_default ) { _default = 0; }
        if ( typeof(el) == 'string' ) { el = Dom.get(el); }
        field=el.innerHTML; Field=PxU.initialCaps(field);
        el.innerHTML = "<div class='phedex-nextgen-filter-element'>" +
                         "<div class='phedex-nextgen-label' id='phedex-label-"+field+"'>"+Field+":</div>" +
                         "<div class='phedex-nextgen-filter'>" +
                           "<div id='phedex-filterpanel-ctl-"+field+"'></div>" +
                         "</div>" +
                       "</div>";
        button = new Button({
          id:          'menubutton-'+id,
          name:        'menubutton-'+id,
          label:        menu[_default].text,
          type:        'menu',
          lazyloadmenu: false,
          menu:         menu,
          container:    'phedex-filterpanel-ctl-'+field
        });
        button.on('selectedMenuItemChange', this.onSelectedMenuItemChange(field,'filter'));
        this._default[field] = function(_button,index) {
          return function() { _button.set('selectedMenuItem',_button.getMenu().getItem(index||_default)); };
        }(button,0);
      },
      makeGroupMenu: function(el,menu,_default) {
        var groups=this.groups, menu, button, i, id=PxU.Sequence();
        if ( typeof(el) == 'string' ) { el = Dom.get(el); }
        if ( !groups ) {
          el.innerHTML = '&nbsp;<strong>Error</strong> loading group names, cannot continue';
          Dom.addClass(e,'phedex-box-red');
          _sbx.notify(this.id,'abort');
          return;
        }
        el.innerHTML='';
        if ( !menu ) { menu = []; }
        for (i in groups ) {
          group = groups[i];
          if ( !group.name.match(/^deprecated-/) ) {
            menu.push( { text:group.name, value:group.id } );
          }
        }
        if ( !_default ) { _default = menu[0].text; }
        button = new Button({
          id:          'menubutton-'+id,
          name:        'menubutton-'+id,
          label:       _default,
          type:        'menu',
          lazyloadmenu: false,
          menu:         menu,
          container:    el
        });
        button.getMenu().cfg.setProperty('scrollincrement',5);
        return button;
      },
      gotGroupMenu: function(data,context,response) {
        PHEDEX.Datasvc.throwIfError(data,response);
// I have two group menus on this form, one in the filter-panel, one in the update-subscription form
        var button, field;
// use 'obj', not this, because I am the datasvc callback. Scope is different...
        obj.groups = data.group;
        field = 'phedex-filterpanel-ctl-group';
        button = obj.makeGroupMenu(field, [{ text:'any', value:0 }] );
        button.on('selectedMenuItemChange', obj.onSelectedMenuItemChange('group','filter'));
        obj._default['group'] = function(_button,index) {
          return function() { _button.set('selectedMenuItem',_button.getMenu().getItem(index||0)); };
        }(button,0);

        field = 'phedex-data-subscriptions-ctl-group';
        button = obj.makeGroupMenu(field,[], 'Choose a group');
        button.on('selectedMenuItemChange', obj.onSelectedMenuItemChange('group'));
        button.set('disabled',true);
        obj.ctl.group = button;
      }
    }
  }
  Yla(this,_construct(this),true);
  return this;
}

log('loaded...','info','nextgen-data-subscriptions');
