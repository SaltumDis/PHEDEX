/**
* The class is used to create pending requests module that is used to show pending requests for the given node name, group name.
* The pending requests information is obtained from Phedex database using web APIs provided by Phedex and is formatted to 
* show it to user in a YUI datatable.
* @namespace PHEDEX.Module
* @class PendingRequests
* @constructor
* @param sandbox {PHEDEX.Sandbox} reference to a PhEDEx sandbox object
* @param string {string} a string to use as the base-name of the <strong>Id</strong> for this module
*/
PHEDEX.namespace('Module');
PHEDEX.Module.PendingRequests = function (sandbox, string) {
    Yla(this, new PHEDEX.DataTable(sandbox, string));

    var _sbx = sandbox, _nodename = '', _groupname = '';
    log('Module: creating a genuine "' + string + '"', 'info', string);

    //Used to construct the pending requests module.
    _construct = function () {
        return {
            /**
            * Used for styling the elements of the module.
            * @property decorators
            * @type Object[]
            */
            decorators: [
                {
                    name: 'cMenuButton',
                    source: 'component-splitbutton',
                    payload: {
                        name: 'Show all fields',
                        map: { hideColumn: 'addMenuItem' },
                        container: 'param'
                    }
                },
                {
                    name: 'ContextMenu',
                    source: 'component-contextmenu',
                    payload: {
                        args: { 'pendingrequests': 'Name' }
                    }
                }
            ],

            /**
            * Properties used for configuring the module.
            * @property meta
            * @type Object
            */
            meta: {
                ctxArgs: { 'Node': 'node', 'Group': 'group' },
                table: { columns: [{ key: 'id', label: 'Request ID', className: 'align-right', parser: 'number' },
                                   { key: "time_create", label: 'TimeCreate', formatter: 'UnixEpochToGMT', parser: 'number' },
                                   { key: 'group', label: 'Group' },
                                   { key: 'priority', label: 'Priority' },
                                   { key: 'custodial', label: 'Custodial' },
                                   { key: 'static', label: 'Static' },
                                   { key: 'move', label: 'Move' },
                                   { key: 'node_id', label: 'Node ID', className: 'align-right', parser: 'number' },
                                   { key: 'name', label: 'Node' },
                                   { key: 'se', label: 'SE'}]
                },
                hide: ['Node ID', 'Request ID'],
                sort: { field: 'Request ID' },
                filter: {
                    'PendingRequests attributes': {
                        map: { to: 'P' },
                        fields: {
                            'Request ID': { type: 'int', text: 'Request ID', tip: 'Request-ID' },
                            'TimeCreate': { type: 'minmax', text: 'TimeCreate', tip: 'time of creation in unix-epoch seconds' },
                            'Group': { type: 'regex', text: 'Group', tip: 'javascript regular expression' },
                            'Priority': { type: 'regex', text: 'Priority', tip: 'javascript regular expression' },
                            'Custodial': { type: 'yesno', text: 'Custodial', tip: 'Show custodial and/or non-custodial files (default is both)' },
                            'Static': { type: 'yesno', text: 'Static', tip: 'Show request static value (default is both)' },
                            'Move': { type: 'yesno', text: 'Move', tip: 'Show if file had been moved or not (default is both)' },
                            'Node ID': { type: 'int', text: 'Node ID', tip: 'Node ID' },
                            'Node': { type: 'regex', text: 'Node name', tip: 'javascript regular expression' },
                            'SE': { type: 'regex', text: 'SE', tip: 'javascript regular expression' }
                        }
                    }
                }
            },

            /**
            * Processes i.e flatten the response data so as to create a YAHOO.util.DataSource and display it on-screen.
            * @method _processData
            * @param jsonBlkData {object} tabular data (2-d array) used to fill the datatable. The structure is expected to conform to <strong>data[i][key] = value</strong>, where <strong>i</strong> counts the rows, and <strong>key</strong> matches a name in the <strong>columnDefs</strong> for this table.
            * @private
            */
            _processData: function (jsonReqData) {
                var indx, indxReq, indxData, jsonReqs, jsonNode, arrReq, arrData = [],
                arrRequestCols = ['id', 'time_create', 'group', 'priority', 'custodial', 'static', 'move'],
                arrNodeCols = ['se', 'id', 'name'],
                arrDTNodeCols = ['se', 'node_id', 'name'],
                nArrRLen = arrRequestCols.length, nArrNLen = arrNodeCols.length,
                nReqLen = jsonReqData.length, nDataLen;
                for (indxReq = 0; indxReq < nReqLen; indxReq++) {
                    jsonReqs = jsonReqData[indxReq];
                    jsonReq = jsonReqData[indxReq].destinations.node;
                    nDataLen = jsonReq.length;
                    for (indxData = 0; indxData < nDataLen; indxData++) {
                        jsonNode = jsonReq[indxData];
                        arrReq = [];
                        for (indx = 0; indx < nArrRLen; indx++) {
                            if (this.meta.parser[arrRequestCols[indx]]) {
                                arrReq[arrRequestCols[indx]] = this.meta.parser[arrRequestCols[indx]](jsonReqs[arrRequestCols[indx]]);
                            }
                            else {
                                arrReq[arrRequestCols[indx]] = jsonReqs[arrRequestCols[indx]];
                            }
                        }
                        for (indx = 0; indx < nArrNLen; indx++) {
                            if (this.meta.parser[arrDTNodeCols[indx]]) {
                                arrReq[arrDTNodeCols[indx]] = this.meta.parser[arrDTNodeCols[indx]](jsonNode[arrNodeCols[indx]]);
                            }
                            else {
                                arrReq[arrDTNodeCols[indx]] = jsonNode[arrNodeCols[indx]];
                            }
                        }
                        arrData.push(arrReq);
                    }
                }
                log("The data has been processed for data source", 'info', this.me);
                this.needProcess = false;
                return arrData;
            },

            /**
            * This inits the Phedex.PendingRequests module and notify to sandbox about its status.
            * @method initData
            */
            initData: function () {
                this.dom.title.innerHTML = 'Waiting for parameters to be set...';
                if (_nodename || _groupname) {
                    _sbx.notify(this.id, 'initData');
                    return;
                }
                _sbx.notify('module', 'needArguments', this.id);
            },

            /** Call this to set the parameters of this module and cause it to fetch new data from the data-service.
            * @method setArgs
            * @param arr {array} object containing arguments for this module. Highly module-specific! For the <strong>PendingRequests</strong> module, only <strong>arr.block</strong> is required. <strong>arr</strong> may be null, in which case no data will be fetched.
            */
            setArgs: function (args) {
                if (!args) { return; }
                if (!(args.node) && !(args.group)) { return; }
                if (args.group) { _groupname = args.group; }
                else { _groupname = ''; }
                if (args.node) { _nodename = args.node; }
                else { _nodename = ''; }
                this.dom.title.innerHTML = 'setting parameters...';
                _sbx.notify(this.id, 'setArgs');
            },
            /**
            * This gets the pending requests information from Phedex data service for the given block name through sandbox.
            * @method getData
            */
            getData: function () {
                if ((!_nodename) && (!_groupname)) {
                    this.initData();
                    return;
                }
                var dataserviceargs = {};
                log('Fetching data', 'info', this.me);
                this.dom.title.innerHTML = this.me + ': fetching data...';
                if (_nodename && _groupname) {
                    dataserviceargs = { approval: 'pending', node: _nodename, group: _groupname };
                }
                else if (_nodename) {
                    dataserviceargs = { approval: 'pending', node: _nodename };
                }
                else if (_groupname) {
                    dataserviceargs = { approval: 'pending', group: _groupname };
                }
                _sbx.notify(this.id, 'getData', { api: 'transferrequests', args: dataserviceargs });
            },

            /**
            * This processes the pending requests information obtained from data service and shows in YUI datatable.
            * @method gotData
            * @param data {object} pending requests information in json format.
            */
            gotData: function (data) {
                var msg = '';
                log('Got new data', 'info', this.me);
                this.dom.title.innerHTML = 'Parsing data';
                this.data = data.request;
                if (!data.request) {
                    throw new Error('data incomplete for ' + context.api);
                }
                this.fillDataSource(this.data);
                if (_nodename && _groupname) {
                    msg = 'for node: ' + _nodename + ' and group: ' + _groupname;
                }
                else if (_nodename) {
                    msg = 'for node: ' + _nodename;
                }
                else if (_groupname) {
                    msg = 'for group: ' + _groupname;
                }
                this.dom.title.innerHTML = this.data.length + ' pending request(s) ' + msg;
                _sbx.notify(this.id, 'gotData');
            }
        };
    };
    Yla(this, _construct(), true);
    return this;
};

log('loaded...', 'info', 'pendingrequests');