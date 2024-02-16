import React from 'react';
import { useAuth0 } from '@auth0/auth0-react';
const { loginWithRedirect, logout, isAuthenticated } = useAuth0();

export const Navbar = () => {
  return (
    <div>
      {isAuthenticated ? (
        <button onClick={() => logout()}>Logout</button>
      ) : (
        <button onClick={() => loginWithRedirect()}>Login</button>
      )}
    </div>
  );
};
