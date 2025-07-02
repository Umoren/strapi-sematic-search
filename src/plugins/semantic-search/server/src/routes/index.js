'use strict';

module.exports = {
  'content-api': {
    type: 'content-api',
    routes: [
      {
        method: 'POST',
        path: '/search',
        handler: 'searchController.search',
        config: {
          auth: false,
          description: 'Perform semantic search on a specific content type',
          tags: ['semantic-search'],
        }
      },
      {
        method: 'POST',
        path: '/multi-search',
        handler: 'searchController.multiSearch',
        config: {
          auth: false,
          description: 'Perform semantic search across multiple content types',
          tags: ['semantic-search'],
        }
      },
      {
        method: 'GET',
        path: '/stats',
        handler: 'searchController.getStats',
        config: {
          auth: false,
          description: 'Get embedding statistics for content types',
          tags: ['semantic-search'],
        }
      }
    ]
  }
};