import { Routes, Route, Navigate } from 'react-router-dom';
import VersionGate from './shell/VersionGate.jsx';
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
import PortalShell from './portal/PortalShell.jsx';
import UpcomingToursPage from './portal/tours/UpcomingToursPage.jsx';
import PastToursPage from './portal/tours/PastToursPage.jsx';
import ProceduresPage from './portal/ProceduresPage.jsx';
import GuideTourPage from './portal/tours/GuideTourPage.jsx';
import ProfilePage from './portal/ProfilePage.jsx';
import PayPage from './portal/PayPage.jsx';
import TrainingPage, { TrainingTourPage } from './portal/training/TrainingPage.jsx';
import TrainingStationPage from './portal/training/TrainingStationPage.jsx';
import PlaceholderPage from './portal/PlaceholderPage.jsx';
import GuideTourGallery from './portal/GuideTourGallery.jsx';
import CustomerGalleryPage from './gallery/CustomerGalleryPage.jsx';
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
// CRM — the operational hub. Tasks (משימות) is the primary daily workspace and
// the landing route; Deals/Contacts/Organizations are reached from that work.
import CrmLayout from './admin/crm/CrmLayout.jsx';
import TasksWorkspace from './admin/crm/tasks/TasksWorkspace.jsx';
import OrganizationsList from './admin/crm/organizations/OrganizationsList.jsx';
import OrganizationDetail from './admin/crm/organizations/OrganizationDetail.jsx';
import ContactsList from './admin/crm/contacts/ContactsList.jsx';
import ContactDetail from './admin/crm/contacts/ContactDetail.jsx';
import CrmSettingsPage from './admin/crm/settings/CrmSettingsPage.jsx';
// Deal module (commercial core) — deals + pipeline.
import DealsList from './admin/deals/DealsList.jsx';
// כספים (Finance) hub — collection (existing, unchanged) + payroll + finance
// management under one tabbed layout.
import FinanceLayout from './admin/finance/FinanceLayout.jsx';
import FinancePlaceholder from './admin/finance/FinancePlaceholder.jsx';
import PayrollDayPage from './admin/finance/payroll/PayrollDayPage.jsx';
import PayrollReportPage from './admin/finance/payroll/PayrollReportPage.jsx';
import CollectionPage from './admin/collection/CollectionPage.jsx';
// Aliased: ToursPage is taken by the PUBLIC tours page import below.
import AdminToursPage from './admin/tours/ToursPage.jsx';
import ControlPage from './admin/control/ControlPage.jsx';
// TEMPORARY — Migration Review Center (removed after cutover).
import MigrationLayout from './admin/migration/MigrationLayout.jsx';
import StageConfigTab from './admin/migration/tabs/StageConfigTab.jsx';
import OrganizationsTab from './admin/migration/tabs/OrganizationsTab.jsx';
import SnapshotBrowserTab from './admin/migration/tabs/SnapshotBrowserTab.jsx';
import ContactsTab from './admin/migration/tabs/ContactsTab.jsx';
import NameCleanupTab from './admin/migration/tabs/NameCleanupTab.jsx';
import ExceptionalTab from './admin/migration/tabs/ExceptionalTab.jsx';
import TourEventPage from './admin/tours/TourPage.jsx';
import DealDetail from './admin/deals/DealDetail.jsx';
import QuotePreviewCanvas from './admin/quote/QuotePreviewCanvas.jsx';
import QuoteSnapshotView from './admin/quote/QuoteSnapshotView.jsx';
import CustomerQuoteView from './quote/CustomerQuoteView.jsx';
// Questionnaire Engine — template list + builder + new-tab preview.
import QuestionnairesPage from './admin/questionnaires/QuestionnairesPage.jsx';
import QuestionnaireBuilderPage from './admin/questionnaires/QuestionnaireBuilderPage.jsx';
import QuestionnairePreviewPage from './admin/questionnaires/QuestionnairePreviewPage.jsx';
import PublicFormPage from './questionnaire/PublicFormPage.jsx';
// Global Settings module (low-frequency configuration).
import SettingsHome from './admin/settings/SettingsHome.jsx';
import ToursSettings from './admin/settings/ToursSettings.jsx';
import OpenToursSettings from './admin/tours/settings/OpenToursSettings.jsx';
import TourComponentsSettingsPage from './admin/tours/settings/TourComponentsSettingsPage.jsx';
import CoordinationSettingsPage from './admin/tours/settings/CoordinationSettingsPage.jsx';
import TourSummarySettingsPage from './admin/tours/settings/TourSummarySettingsPage.jsx';
import GuidePermissionsSettings from './admin/tours/settings/GuidePermissionsSettings.jsx';
import GallerySettingsPage from './admin/tours/settings/GallerySettingsPage.jsx';
import WhatsAppConnectionsPage from './admin/settings/WhatsAppConnectionsPage.jsx';
import EmailPage from './admin/email/EmailPage.jsx';
import CrmSettingsHome from './admin/settings/CrmSettingsHome.jsx';
import FinanceSettingsHome from './admin/settings/FinanceSettingsHome.jsx';
import PayrollComponentsSettings from './admin/finance/settings/PayrollComponentsSettings.jsx';
import GeneralActivityTypesSettings from './admin/finance/settings/GeneralActivityTypesSettings.jsx';
import ProductsAreaHome from './admin/settings/ProductsAreaHome.jsx';
import DealStagesSettings from './admin/crm/settings/DealStagesSettings.jsx';
import LostReasonsSettings from './admin/crm/settings/LostReasonsSettings.jsx';
import DealSourcesSettings from './admin/crm/settings/DealSourcesSettings.jsx';
import TaskTypesSettings from './admin/crm/settings/TaskTypesSettings.jsx';
import QuoteSectionsSettings from './admin/crm/settings/QuoteSectionsSettings.jsx';
import QuoteLayoutSettings from './admin/crm/settings/QuoteLayoutSettings.jsx';
import TicketTypesSettings from './admin/crm/settings/TicketTypesSettings.jsx';
import SabbathHoursSettings from './admin/crm/settings/SabbathHoursSettings.jsx';
// Products & Pricing — Slice 1 (catalog + files + payment config).
import ProductsSettings from './admin/products/ProductsSettings.jsx';
import SharedContentLibrary from './admin/shared-content/SharedContentLibrary.jsx';
// Tour Content module — GOS-owned internal tour content. 3-pane master-detail:
// Tours → Stations → Station editor (workflow-first; the content library is
// contextual, not a nav tab).
import TourContentShell from './admin/tour-content/TourContentShell.jsx';
import TcEmptyEditor from './admin/tour-content/EmptyEditor.jsx';
import TcStationEditor from './admin/tour-content/StationEditor.jsx';
import TcStationPreview from './admin/tour-content/StationPreview.jsx';
import ProductDetail from './admin/products/ProductDetail.jsx';
import VariantEditor from './admin/products/VariantEditor.jsx';
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
    <>
      {/* Global, route-agnostic: detects a new deployment and updates open tabs
          at a safe moment (non-blocking toast + auto-reload on navigation). */}
      <VersionGate />
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
        {/* בקרה is the admin landing page — the first thing an admin sees is
            "מה דורש טיפול עכשיו?", not a module picked by history. */}
        <Route index element={<Navigate to="/admin/control" replace />} />
        <Route path="control" element={<ControlPage />} />
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
        {/* CRM hub — Tasks (the primary daily workspace) + Deals + Contacts + Organizations. */}
        <Route path="crm" element={<CrmLayout />}>
          <Route index element={<Navigate to="/admin/crm/tasks" replace />} />
          <Route path="tasks" element={<TasksWorkspace />} />
          <Route path="deals" element={<DealsList />} />
          <Route path="deals/:id" element={<DealDetail />} />
          <Route path="contacts" element={<ContactsList />} />
          <Route path="contacts/:id" element={<ContactDetail />} />
          <Route path="organizations" element={<OrganizationsList />} />
          <Route path="organizations/:id" element={<OrganizationDetail />} />
        </Route>
        {/* כספים — the finance hub. Collection (גבייה מלקוחות) is the existing
            module, unchanged besides its navigation home; payroll (שכר צוות)
            and finance management (ניהול פיננסי) are honest placeholders until
            their slices land. */}
        <Route path="finance" element={<FinanceLayout />}>
          <Route index element={<Navigate to="/admin/finance/collection" replace />} />
          <Route path="collection" element={<CollectionPage />} />
          <Route path="payroll" element={<PayrollDayPage />} />
          <Route path="payroll/reports" element={<PayrollReportPage />} />
          <Route
            path="management"
            element={
              <FinancePlaceholder
                icon="📊"
                title="ניהול פיננסי"
                description="אזור הניהול הפיננסי עדיין לא נבנה. כשייבנה, כאן יופיעו כלי הניהול הפיננסיים של העסק."
              />
            }
          />
        </Route>
        {/* Old collection URL keeps working for existing links/bookmarks. */}
        <Route path="collection" element={<Navigate to="/admin/finance/collection" replace />} />
        {/* בדיקת מיגרציה — TEMPORARY one-time Migration Review Center.
            DELETION BOUNDARY: this route block + client/src/admin/migration/ +
            the moduleRoutes entry + the server's /api/migration/review surface.
            Landing on stage-config: it is the only fully-built tab. */}
        <Route path="migration" element={<MigrationLayout />}>
          <Route index element={<Navigate to="/admin/migration/stage-config" replace />} />
          <Route path="organizations" element={<OrganizationsTab />} />
          <Route path="contacts" element={<ContactsTab />} />
          <Route path="name-cleanup" element={<NameCleanupTab />} />
          <Route path="stage-config" element={<StageConfigTab />} />
          <Route path="exceptional" element={<ExceptionalTab />} />
          {/* Tab 6 "ארכיון מערכת קודמת" IS the read-only Snapshot Browser. */}
          <Route path="legacy-archive" element={<SnapshotBrowserTab />} />
        </Route>
        {/* Tours — the operational tours module (TourEvent/Booking): table of
            upcoming tours + group slot management. Calendar views come later. */}
        {/* The tour opens as a modal on top of the list — nested so the list
            stays mounted behind it (rendered via ToursPage's <Outlet />). */}
        <Route path="tours" element={<AdminToursPage />}>
          <Route path=":id" element={<TourEventPage />} />
        </Route>
        {/* Questionnaire Engine — generic templates (tour summary /
            coordination / future forms). List + per-template builder. */}
        <Route path="questionnaires" element={<QuestionnairesPage />} />
        <Route path="questionnaires/:id" element={<QuestionnaireBuilderPage />} />
        {/* Quote Preview Canvas (Slice 3) — internal admin draft workspace,
            opened from a Deal. NOT the public quote page. */}
        <Route path="quote/:dealId" element={<QuotePreviewCanvas />} />
        {/* Admin archive view of a generated quote's frozen snapshot (the
            public URL of a superseded version shows the replacement screen). */}
        <Route path="quote-view/:docId" element={<QuoteSnapshotView />} />
        {/* Global Settings — category cards. CRM Settings (incl. the
            Organization Types / Subtypes / Deal Stages screen) lives here,
            no longer as a prominent CRM tab. */}
        <Route path="settings" element={<SettingsHome />} />
        {/* WhatsApp is a top-level module (inbox + connections); the old
            settings path keeps working for existing links/bookmarks. */}
        <Route path="whatsapp" element={<WhatsAppConnectionsPage />} />
        <Route path="settings/whatsapp" element={<WhatsAppConnectionsPage />} />
        {/* Email is a top-level module (inbox + Gmail account management). */}
        <Route path="email" element={<EmailPage />} />
        {/* Tours module settings — the future configuration surface (guide
            permission placeholders); the Tours module itself is not built yet. */}
        <Route path="settings/tours" element={<ToursSettings />} />
        <Route path="settings/tours/open-tours" element={<OpenToursSettings />} />
        <Route path="settings/tours/components" element={<TourComponentsSettingsPage />} />
        <Route path="settings/tours/coordination" element={<CoordinationSettingsPage />} />
        <Route path="settings/tours/summary" element={<TourSummarySettingsPage />} />
        <Route path="settings/tours/guide-permissions" element={<GuidePermissionsSettings />} />
        <Route path="settings/tours/gallery" element={<GallerySettingsPage />} />
        <Route path="settings/finance" element={<FinanceSettingsHome />} />
        <Route path="settings/finance/payroll-components" element={<PayrollComponentsSettings />} />
        <Route path="settings/finance/activity-types" element={<GeneralActivityTypesSettings />} />
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
          path="settings/crm/task-types"
          element={<TaskTypesSettings />}
        />
        <Route
          path="settings/crm/quote-sections"
          element={<QuoteSectionsSettings />}
        />
        <Route
          path="settings/crm/quote-layout"
          element={<QuoteLayoutSettings />}
        />
        <Route path="settings/crm/products-area" element={<ProductsAreaHome />} />
        <Route path="settings/crm/products" element={<ProductsSettings />} />
        <Route path="settings/crm/products/:id" element={<ProductDetail />} />
        <Route path="settings/crm/products/:id/variant/:variantId" element={<VariantEditor />} />
        <Route path="settings/crm/locations" element={<LocationsSettings />} />
        <Route path="settings/crm/payment" element={<PaymentConfigSettings />} />
        <Route path="settings/crm/pricing" element={<PricingBoard />} />
        <Route path="settings/crm/pricing/advanced" element={<PricingSettings />} />
        <Route path="settings/crm/addons" element={<AddonsSettings />} />
        <Route path="settings/crm/ticket-types" element={<TicketTypesSettings />} />
        <Route path="settings/crm/sabbath-hours" element={<SabbathHoursSettings />} />
        <Route path="settings/crm/shared-content" element={<SharedContentLibrary />} />
        {/* Tour Content — 3-pane master-detail. Tours → Stations → Station editor.
            The two list panes persist (in the shell); the editor is the Outlet. */}
        <Route path="tour-content" element={<TourContentShell />}>
          <Route index element={<TcEmptyEditor hint="בחרו סיור מהרשימה כדי להתחיל" />} />
          <Route path="tours/:tourId" element={<TcEmptyEditor hint="בחרו תחנה לעריכה" />} />
          <Route path="tours/:tourId/stations/:stationId" element={<TcStationEditor />} />
        </Route>
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
      {/* Guide portal — token-gated, mobile-first app shell: bottom nav
          (סיורים / סיורי עבר / שכר) + hamburger (משובים / נהלים / מערכי
          הדרכה / פרטים אישיים). Tab visibility follows server permissions;
          enforcement is ALWAYS server-side. */}
      <Route path="/p/:token" element={<PortalShell />}>
        <Route index element={<UpcomingToursPage />} />
        <Route path="past" element={<PastToursPage />} />
        <Route path="pay" element={<PayPage />} />
        <Route path="procedures" element={<ProceduresPage />} />
        <Route
          path="feedback"
          element={
            <PlaceholderPage
              icon="💬"
              title="משובים"
              description="מודול המשובים עדיין לא זמין בפורטל. כשייבנה, כאן יופיעו משובים על הסיורים שלך."
            />
          }
        />
        {/* מערכי הדרכה — permitted training content (server double-gated:
            viewTraining permission + explicit per-station grants). One
            permitted tour lands straight on its stations. */}
        <Route path="training" element={<TrainingPage />} />
        <Route path="training/tours/:tourId" element={<TrainingTourPage />} />
        <Route path="training/stations/:stationId" element={<TrainingStationPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* Tour detail — read-only operational view (admin-modal hierarchy,
            guide-safe DTO). Lives inside the shell so the bottom nav stays. */}
        <Route path="tour/:tourEventId" element={<GuideTourPage />} />
      </Route>
      {/* Guide Portal → one tour's gallery (mobile-first upload + grid).
          Full-screen on purpose — media browsing wants the whole viewport. */}
      <Route path="/p/:token/tour/:tourEventId/gallery" element={<GuideTourGallery />} />
      {/* PUBLIC customer tour gallery — capability URL, branded event page. */}
      <Route path="/g/:token" element={<CustomerGalleryPage />} />
      {/* Public customer quote page — token-gated (QuoteDocument.publicToken),
          no admin auth. The customer-facing proposal viewer + signature flow. */}
      <Route path="/quote/:token" element={<CustomerQuoteView />} />
      {/* Public questionnaire fill (coordination form etc.) — token-gated
          (QuestionnaireLink.token), no admin auth, mobile-first. */}
      <Route path="/form/:token" element={<PublicFormPage />} />
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
      {/* Read-only station preview (Tour Content) — opened in a new tab from the
          station editor. Uses the admin session; renders visible parts + media. */}
      <Route path="/preview/tour-station/:stationId" element={<TcStationPreview />} />
      {/* Questionnaire builder preview — new tab, real fill runtime, never
          saves. Data loads through the admin session (same as tour-station). */}
      <Route path="/preview/questionnaire/:versionId" element={<QuestionnairePreviewPage />} />
      {/* TEMPORARY public-website foundation preview (Phase 1/2). Removed at
          Step 4 when the public site takes over root "/". */}
      <Route path="/__preview/public" element={<PublicApp />} />
      <Route path="/__preview/home" element={<HomePage />} />
      <Route path="/__preview/accessibility" element={<AccessibilityPage />} />
      <Route path="/__preview/tours" element={<ToursPage />} />
      <Route path="/__preview/tour" element={<TourDetailPage />} />
      {/* Catch-all — no route may fall through to a blank page or inherit the
          previously-rendered shell. Unknown paths go to the root resolver,
          which (no URL token) sends them to /admin. It NEVER infers a guide
          portal from device storage (see Landing / landingResolve.js). */}
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
