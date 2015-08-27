var elasticsearch = require( "elasticsearch" ),
    _ = require( "underscore" ),
    config = require( "../config" ),
    esClient = { connection: null };

esClient.connect = function( ) {
  if( esClient.connection ) { return esClient.connection; }
  esClient.connection = new elasticsearch.Client({
    host: process.env.ELASTICSEARCH_HOST ||
      config.elasticsearch.host || "127.0.0.1:9200",
    log: false // "debug"
  });
  return esClient.connection;
};

esClient.compileWheres = function( elastic_query ) {
  if( !elastic_query || !_.isObject( elastic_query ) ) { return [ ]; }
  var whereClauses = [ ];
  elastic_query.where = elastic_query.where || { };
  _.each( elastic_query.where, function( val, key ) {
    var clause = { };
    if( _.isArray( val ) ) {
      clause.terms = { };
      clause.terms[ key ] = val;
    } else if( _.isObject( val ) ) {
      clause[ key ] = val;
    } else {
      clause.match = { };
      clause.match[ key ] = val;
    }
    whereClauses.push( clause );
  });
  return whereClauses;
};

esClient.compileFilters = function( elastic_query ) {
  if( !_.isObject( elastic_query ) || !elastic_query.filters ||
      !_.isArray( elastic_query.filters )) {
    return [ ];
  }
  return _.compact( _.map( elastic_query.filters, function( f ) {
    if( !_.isObject( f ) || _.size( f ) !== 1 ) { return; }
    if( f.envelope ) {
      return esClient.envelopeFilter( f );
    }
    return f;
  }));
};

esClient.envelopeFilter = function( filter ) {
  if( !_.isObject( filter ) || !filter.envelope ) { return; };
  var field = _.keys( filter.envelope )[0]
  var opts = filter.envelope[ field ];
    if( !( opts.nelat || opts.nelng || opts.swlat || opts.swlng ) ) { return; }
  opts.swlng = parseFloat(opts.swlng || -180);
  opts.swlat = parseFloat(opts.swlat || -90);
  opts.nelng = parseFloat(opts.nelng || 180);
  opts.nelat = parseFloat(opts.nelat || 90);
  if( opts.nelng && opts.swlng && opts.nelng < opts.swlng ) {
    // the envelope crosses the dateline. Unfortunately, elasticsearch
    // doesn't handle this well and we need to split the envelope at
    // the dateline and do an OR query
    var original_nelng = opts.nelng;
    return { or: [
        esClient.envelopeFilter( _.mapObject( filter, function( val, key ) {
          val[ field ].nelng = 180;
          return val;
        })),
        esClient.envelopeFilter( _.mapObject( filter, function( val, key ) {
          val[ field ].nelng = original_nelng;
          val[ field ].swlng = -180;
          return val;
        }))]};
  }
  var envelope = { geo_shape: { } };
  envelope.geo_shape[ field ] = {
    shape: {
      type: "envelope",
      coordinates: [
        [ opts.swlng, opts.swlat ],
        [ opts.nelng, opts.nelat ]
      ]
    }
  };
  return envelope;
};

esClient.searchHash = function( elastic_query ) {
  var wheres = esClient.compileWheres( elastic_query );
  var filters = esClient.compileFilters( elastic_query );
  var query = _.isEmpty( wheres ) ?
    { match_all: { } } :
    { bool: { must: wheres } };
  // when there are filters, the query needs to be wrapped
  // in a filtered block that includes the filters being applied
  if( filters.length > 0 ) {
    query = {
      filtered: {
        query: query,
        filter: {
          bool: { must: filters } } } };
  }
  elastic_query.per_page = elastic_query.per_page || 30;
  if( elastic_query.per_page > 200 ) { elastic_query.per_page = 200; }
  elastic_query.page = elastic_query.page || 1;
  var elastic_hash = { query: query };
  if( elastic_query.sort ) { elastic_hash.sort = elastic_query.sort; }
  if( elastic_query.fields ) { elastic_hash.fields = elastic_query.fields; }
  elastic_hash.size = elastic_query.per_page;
  elastic_hash.from = ( elastic_query.page - 1 ) * elastic_query.per_page;
  elastic_hash.highlight = elastic_query.highlight;
  return elastic_hash;
};

esClient.connect( );

module.exports = esClient;