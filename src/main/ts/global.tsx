import React from 'react';
import { DependencySearchPanel } from './components/DependencySearchPanel';

(globalThis as any).registerExtension('dependencysearch/global', () => {
  return <DependencySearchPanel mode="global" />;
});
