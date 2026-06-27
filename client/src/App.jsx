import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './shell/AppShell.jsx';
import Landing from './shell/Landing.jsx';
import AdminGuard from './admin/auth/AdminGuard.jsx';
import AdminLogin from './admin/auth/AdminLogin.jsx';
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
import InstallGuidePage from './portal/InstallGuidePage.jsx';
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
import AdminUsersPage from './admin/users/AdminUsersPage.jsx';
// CRM foundation (Phase 1) — secondary reference/management surface. Daily work
// will start from Activities (built later); these pages are reached from Deals.
import CrmLayout from './admin/crm/CrmLayout.jsx';
import OrganizationsList from './admin/crm/organizations/OrganizationsList.jsx';
import OrganizationDetail from './admin/crm/organizations/OrganizationDetail.jsx';
import ContactsList from './admin/crm/contacts/ContactsList.jsx';
import ContactDetail from './admin/crm/contacts/ContactDetail.jsx';
import CrmSettingsPage from './admin/crm/settings/CrmSettingsPage.jsx';
// Deal module (commercial core) — deals + pipeline.
import DealsList from './admin/deals/DealsList.jsx';
import DealDetail from './admin/deals/DealDetail.jsx';
// Global Settings module (low-frequency configuration).
import SettingsHome from './admin/settings/SettingsHome.jsx';
import CrmSettingsHome from './admin/settings/CrmSettingsHome.jsx';
import ProductsAreaHome from './admin/settings/ProductsAreaHome.jsx';
import DealStagesSettings from './admin/crm/settings/DealStagesSettings.jsx';
import LostReasonsSettings from './admin/crm/settings/LostReasonsSettings.jsx';
import DealSourcesSettings from './admin/crm/settings/DealSourcesSettings.jsx';
import QuoteSectionsSettings from './admin/crm/settings/QuoteSectionsSettings.jsx';
import TicketTypesSettings from './admin/crm/settings/TicketTypesSettings.jsx';
import SabbathHoursSettings from './admin/crm/settings/SabbathHoursSettings.jsx';
// Products & Pricing — Slice 1 (catalog + files + payment config).
import ProductsSettings from './admin/products/ProductsSettings.jsx';
import ProductDetail from './admin/products/ProductDetail.jsx';
import LocationsSettings from './admin/products/LocationsSettings.jsx';
import PaymentConfigSettings from './admin/products/PaymentConfigSettings.jsx';
import PricingBoard from './admin/pricing/PricingBoard.jsx';
import PricingSettings from './admin/pricing/PricingSettings.jsx';
import AddonsSettings from './admin/pricing/AddonsSettings.jsx';
// TEMPORARY (Phase 1/2 review scaffolding): mounts the public-website
// foundation at a NON-root path so it can be reviewed without touching the
// root "/" route or the Landing/PWA resolver. This route is removed when the
// real public routing lands in Step 4 (root "/" → public site via Vike).
import PublicApp from './public/PublicApp.jsx';
import HomePage from './public/pages/home/HomePage.jsx';
import AccessibilityPage from './public/pages/legal/AccessibilityPage.jsx';
import ToursPage from './public/pages/tours/ToursPage.jsx';
import TourDetailPage from './public/pages/tours/TourDetailPage.jsx';

export default function App() {
  return (
    <Routes>
      {/* Root route is "smart" — guides who installed the PWA from
          their portal page need to land back on /p/:token, not on
          /admin. See Landing.jsx for the resolution rules.
          /launch is the manifest's start_url; it intentionally lives
          on a public, non-admin path so the launched PWA never has
          to pass through /admin (which would force AdminGuard to
          redirect to /admin/login first). */}
      <Route path="/" element={<Landing />} />
      <Route path="/launch" element={<Landing />} />
      {/* Path-based launch URL — exists because iOS Safari
          consistently preserves PATH segments across the "Add to
          Home Screen" capture, even on iOS versions that drop or
          ignore query strings or that don't honor the manifest's
          start_url at all. */}
      <Route path="/launch/:token" element={<Landing />} />
      {/* Login lives OUTSIDE the AdminGuard so an unauthenticated user
          can actually reach it. The guard wraps every authenticated
          admin route below — its redirect target is /admin/login. */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AppShell />
          </AdminGuard>
        }
      >
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
        {/* CRM hub — Deals (primary) + Contacts + Organizations. */}
        <Route path="crm" element={<CrmLayout />}>
          <Route index element={<Navigate to="/admin/crm/deals" replace />} />
          <Route path="deals" element={<DealsList />} />
          <Route path="deals/:id" element={<DealDetail />} />
          <Route path="contacts" element={<ContactsList />} />
          <Route path="contacts/:id" element={<ContactDetail />} />
          <Route path="organizations" element={<OrganizationsList />} />
          <Route path="organizations/:id" element={<OrganizationDetail />} />
        </Route>
        {/* Global Settings — category cards. CRM Settings (incl. the
            Organization Types / Subtypes / Deal Stages screen) lives here,
            no longer as a prominent CRM tab. */}
        <Route path="settings" element={<SettingsHome />} />
        <Route path="settings/crm" element={<CrmSettingsHome />} />
        <Route
          path="settings/crm/organization-types"
          element={<CrmSettingsPage />}
        />
        <Route
          path="settings/crm/deal-stages"
          element={<DealStagesSettings />}
        />
        <Route
          path="settings/crm/lost-reasons"
          element={<LostReasonsSettings />}
        />
        <Route
          path="settings/crm/deal-sources"
          element={<DealSourcesSettings />}
        />
        <Route
          path="settings/crm/quote-sections"
          element={<QuoteSectionsSettings />}
        />
        <Route path="settings/crm/products-area" element={<ProductsAreaHome />} />
        <Route path="settings/crm/products" element={<ProductsSettings />} />
        <Route path="settings/crm/products/:id" element={<ProductDetail />} />
        <Route path="settings/crm/locations" element={<LocationsSettings />} />
        <Route path="settings/crm/payment" element={<PaymentConfigSettings />} />
        <Route path="settings/crm/pricing" element={<PricingBoard />} />
        <Route path="settings/crm/pricing/advanced" element={<PricingSettings />} />
        <Route path="settings/crm/addons" element={<AddonsSettings />} />
        <Route path="settings/crm/ticket-types" element={<TicketTypesSettings />} />
        <Route path="settings/crm/sabbath-hours" element={<SabbathHoursSettings />} />
        <Route path="users" element={<AdminUsersPage />} />
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
      {/* Dedicated install entry — public, token-bearing URL that
          iOS Safari captures verbatim on Add to Home Screen, and
          that Android Chrome resolves through a per-token manifest
          link. The PATH variant is the deterministic one (iOS
          preserves path segments through standalone launches);
          the query variant is kept as a back-compat alias. */}
      <Route path="/install-guide" element={<InstallGuidePage />} />
      <Route path="/install-guide/:token" element={<InstallGuidePage />} />
      {/* Full-page previews — opened in a new tab from the eye icons. */}
      <Route path="/preview/content/:id" element={<ItemPreviewPage kind="content" />} />
      <Route path="/preview/question/:id" element={<ItemPreviewPage kind="question" />} />
      <Route path="/preview/group/:flowId/:groupId" element={<GroupPreviewPage />} />
      {/* TEMPORARY public-website foundation preview (Phase 1/2). Removed at
          Step 4 when the public site takes over root "/". */}
      <Route path="/__preview/public" element={<PublicApp />} />
      <Route path="/__preview/home" element={<HomePage />} />
      <Route path="/__preview/accessibility" element={<AccessibilityPage />} />
      <Route path="/__preview/tours" element={<ToursPage />} />
      <Route path="/__preview/tour" element={<TourDetailPage />} />
    </Routes>
  );
}
