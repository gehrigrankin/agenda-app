import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';

import './index.css';
import App from './App.tsx';
import { Navbar } from './components/layout/Navbar';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Auth0Provider
      domain="dev-0hzefs6x6brsgy3a.us.auth0.com"
      clientId="D6xHszv63tqs6V442iTgVpIu5mAOSEOd"
      redirectUri={window.location.origin}
    >
      <Navbar />
      <App />
    </Auth0Provider>
  </React.StrictMode>
);
