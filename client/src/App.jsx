import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './shell/AppShell.jsx';
import ProceduresLayout from './admin/procedures/ProceduresLayout.jsx';
import FlowsHome from './admin/procedures/flows/FlowsHome.jsx';
import FlowsIndexView from './admin/procedures/flows/FlowsIndexView.jsx';
import FlowEditor from './admin/procedures/flows/FlowEditor.jsx';
import ApprovalsHome from './admin/procedures/approvals/ApprovalsHome.jsx';
import ApprovalsIndexView from './admin/procedures/approvals/ApprovalsIndexView.jsx';
import ApprovalDetail from './admin/procedures/approvals/ApprovalDetail.jsx';
import BankHome from './admin/procedures/bank/BankHome.jsx';
import BankIndexView from './admin/procedures/bank/BankIndexView.jsx';
import ContentEditor from './admin/procedures/bank/ContentEditor.jsx';
import QuestionEditor from './admin/procedures/bank/QuestionEditor.jsx';
import { FlowEntry, AttemptRuntime } from './learner/LearnerRuntime.jsx';
import GuidePortal from './portal/GuidePortal.jsx';
import DocumentsLayout from './admin/documents/DocumentsLayout.jsx';
import DocumentsIndexPage from './admin/documents/index_/DocumentsIndexPage.jsx';
import TemplatesPage from './admin/documents/templates/TemplatesPage.jsx';
import TemplateEditor from './admin/documents/templates/TemplateEditor.jsx';
import InstanceEditor from './admin/documents/instances/InstanceEditor.jsx';
import SignersPage from './admin/documents/signers/SignersPage.jsx';
import BusinessFieldsPage from './admin/documents/businessFields/BusinessFieldsPage.jsx';
import ItemPreviewPage from './preview/ItemPreviewPage.jsx';
import GroupPreviewPage from './preview/GroupPreviewPage.jsx';
import PeopleLayout from './admin/people/PeopleLayout.jsx';
import PeopleList from './admin/people/PeopleList.jsx';
import PersonProfile from './admin/people/PersonProfile.jsx';
import TeamsPage from './admin/people/TeamsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AppShell />}>
        <Route index element={<Navigate to="/admin/procedures/flows" replace />} />
        <Route path="procedures" element={<ProceduresLayout />}>
          <Route index element={<Navigate to="flows" replace />} />
          <Route path="flows" element={<FlowsHome />}>
            <Route index element={<FlowsIndexView />} />
            <Route path=":id" element={<FlowEditor />} />
          </Route>
          <Route path="bank" element={<BankHome />}>
            <Route index element={<BankIndexView />} />
            {/* "new" pre-creates a row and navigates to its id; the editor
                 only knows about existing rows. */}
            <Route path="content/:id" element={<ContentEditor />} />
            <Route path="question/:id" element={<QuestionEditor />} />
          </Route>
          <Route path="approvals" element={<ApprovalsHome />}>
            <Route index element={<ApprovalsIndexView />} />
            <Route path=":id" element={<ApprovalDetail />} />
          </Route>
        </Route>
        <Route path="people" element={<PeopleLayout />}>
          <Route index element={<PeopleList />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path=":id" element={<PersonProfile />} />
        </Route>
        <Route path="documents" element={<DocumentsLayout />}>
          <Route index element={<DocumentsIndexPage />} />
          <Route path="templates" element={<TemplatesPage />}>
            <Route path=":id" element={<TemplateEditor />} />
          </Route>
          <Route path="instances/:id" element={<InstanceEditor />} />
          <Route path="signers" element={<SignersPage />} />
          <Route path="signers/:id" element={<SignersPage />} />
          <Route path="fields" element={<BusinessFieldsPage />} />
        </Route>
      </Route>
      <Route path="/flow/:id" element={<FlowEntry />} />
      <Route path="/attempt/:attemptId" element={<AttemptRuntime />} />
      {/* Guide portal — token-gated, mobile-first task feed. */}
      <Route path="/p/:token" element={<GuidePortal />} />
      {/* Full-page previews — opened in a new tab from the eye icons. */}
      <Route path="/preview/content/:id" element={<ItemPreviewPage kind="content" />} />
      <Route path="/preview/question/:id" element={<ItemPreviewPage kind="question" />} />
      <Route path="/preview/group/:flowId/:groupId" element={<GroupPreviewPage />} />
    </Routes>
  );
}
