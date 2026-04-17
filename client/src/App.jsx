import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './admin/AdminLayout.jsx';
import FlowsList from './admin/FlowsList.jsx';
import Bank from './admin/Bank.jsx';
import FlowBuilder from './admin/FlowBuilder.jsx';
import Review from './admin/Review.jsx';
import LearnerRuntime from './learner/LearnerRuntime.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<FlowsList />} />
        <Route path="bank" element={<Bank />} />
        <Route path="flows/:id/edit" element={<FlowBuilder />} />
        <Route path="flows/:id/review" element={<Review />} />
      </Route>
      <Route path="/flow/:id" element={<LearnerRuntime />} />
    </Routes>
  );
}
