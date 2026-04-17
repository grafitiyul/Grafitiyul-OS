import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './shell/AppShell.jsx';
import ProceduresLayout from './admin/procedures/ProceduresLayout.jsx';
import FlowsList from './admin/procedures/flows/FlowsList.jsx';
import BankList from './admin/procedures/bank/BankList.jsx';
import ApprovalsList from './admin/procedures/approvals/ApprovalsList.jsx';
import LearnerRuntime from './learner/LearnerRuntime.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AppShell />}>
        <Route index element={<Navigate to="/admin/procedures/flows" replace />} />
        <Route path="procedures" element={<ProceduresLayout />}>
          <Route index element={<Navigate to="flows" replace />} />
          <Route path="flows" element={<FlowsList />} />
          <Route path="bank" element={<BankList />} />
          <Route path="approvals" element={<ApprovalsList />} />
        </Route>
      </Route>
      <Route path="/flow/:id" element={<LearnerRuntime />} />
    </Routes>
  );
}
