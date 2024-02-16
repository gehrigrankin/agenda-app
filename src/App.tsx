import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'; // Import BrowserRouter, Routes, and Route from 'react-router-dom'

import { Home } from './pages/Home';

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<Home />} /> {/* Route for Home component */}
      {/* <Route path="*" element={<NotFound />} /> Route for handling 404 Not Found */}
    </Routes>
  </Router>
);

export default App;