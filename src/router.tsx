import { createBrowserRouter } from 'react-router-dom';
import Hub from './pages/Hub';
import Editor from './pages/Editor';

export const router = createBrowserRouter(
  [
    { path: '/', element: <Hub /> },
    { path: '/editor', element: <Editor /> },
    { path: '/editor/:tool', element: <Editor /> },
    { path: '*', element: <Hub /> },
  ],
  { basename: import.meta.env.BASE_URL },
);
