import React from 'react';
import { DependencySearchPanel } from './components/DependencySearchPanel';

(globalThis as any).registerExtension('dependencysearch/search', (options: any) => {
  return <DependencySearchPanel mode="component" component={options.component} branchLike={options.branchLike} />;
});
