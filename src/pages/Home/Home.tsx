import React from 'react';
import { useAuth0 } from '@auth0/auth0-react';

const { isAuthenticated, user, loginWithRedirect } = useAuth0();

const handleLogin = () => {
  loginWithRedirect(); // Redirect to login page
};

export const Home = () => {
  return (
    <div>
      {isAuthenticated ? (
        <p>Hello, {user ? user.name : 'User'}</p>
      ) : (
        <div>
          <p>Please log in.</p>
          <button onClick={handleLogin}>Login</button>
        </div>
      )}
    </div>
  );
};
