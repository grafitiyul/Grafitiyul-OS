import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './shell/AppShell.jsx';
import ProceduresLayout from './admin/procedures/ProceduresLayout.jsx';
import FlowsList from './admin/procedures/flows/FlowsList.jsx';
import ApprovalsList from './admin/procedures/approvals/ApprovalsList.jsx';
import BankHome from './admin/procedures/bank/BankHome.jsx';
import BankIndexView from './admin/procedures/bank/BankIndexView.jsx';
import ContentEditor from './admin/procedures/bank/ContentEditor.jsx';
import QuestionEditor from './admin/procedures/bank/QuestionEditor.jsx';
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
          <Route path="bank" element={<BankHome />}>
            <Route index element={<BankIndexView />} />
            <Route path="content/new" element={<ContentEditor mode="new" />} />
            <Route path="content/:id" element={<ContentEditor mode="edit" />} />
            <Route path="question/new" element={<QuestionEditor mode="new" />} />
            <Route path="question/:id" element={<QuestionEditor mode="edit" />} />
          </Route>
          <Route path="approvals" element={<ApprovalsList />} />
        </Route>
      </Route>
      <Route path="/flow/:id" element={<LearnerRuntime />} />
    </Routes>
  );
}
