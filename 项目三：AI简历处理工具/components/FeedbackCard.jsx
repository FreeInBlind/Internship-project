// Demo code for FeedbackCard.jsx
import React from 'react';

const FeedbackCard = ({ feedback }) => (
  <div className="feedback-card">
    <h3>Feedback</h3>
    <p>{feedback || 'This is a demo feedback.'}</p>
  </div>
);

export default FeedbackCard;
