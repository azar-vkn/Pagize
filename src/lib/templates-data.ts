import {
  FileText,
  Briefcase,
  Mail,
  ShieldAlert,
  ClipboardList,
  Home,
  PenTool,
  Award,
  type LucideIcon,
} from "lucide-react";

export type TemplateFieldType = "text" | "textarea" | "date" | "number";

export type TemplateField = {
  name: string;
  label: string;
  type: TemplateFieldType;
  placeholder?: string;
  defaultValue?: string;
};

export type TemplateConfig = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  fields: TemplateField[];
};

export const templates: TemplateConfig[] = [
  {
    id: "invoice",
    name: "Invoice",
    description: "Create a professional invoice for your services.",
    icon: FileText,
    fields: [
      { name: "companyName", label: "Company Name", type: "text", placeholder: "Your Company LLC" },
      { name: "invoiceNumber", label: "Invoice Number", type: "text", placeholder: "INV-001" },
      { name: "date", label: "Date", type: "date" },
      { name: "clientName", label: "Client Name", type: "text", placeholder: "Acme Corp" },
      { name: "amount", label: "Amount ($)", type: "number", placeholder: "1000.00" },
      { name: "description", label: "Description", type: "textarea", placeholder: "Web design services..." },
    ],
  },
  {
    id: "resume",
    name: "Resume",
    description: "Build a clean, minimalist resume.",
    icon: Briefcase,
    fields: [
      { name: "fullName", label: "Full Name", type: "text", placeholder: "Jane Doe" },
      { name: "email", label: "Email", type: "text", placeholder: "jane@example.com" },
      { name: "phone", label: "Phone", type: "text", placeholder: "(555) 123-4567" },
      { name: "summary", label: "Professional Summary", type: "textarea", placeholder: "Experienced software engineer..." },
      { name: "experience", label: "Experience", type: "textarea", placeholder: "Company A - Software Engineer (2020-2023)..." },
      { name: "education", label: "Education", type: "textarea", placeholder: "B.S. Computer Science, University X..." },
    ],
  },
  {
    id: "cover-letter",
    name: "Cover Letter",
    description: "A standard cover letter template for job applications.",
    icon: Mail,
    fields: [
      { name: "senderName", label: "Your Name", type: "text", placeholder: "Jane Doe" },
      { name: "recipientName", label: "Hiring Manager Name", type: "text", placeholder: "John Smith" },
      { name: "company", label: "Company", type: "text", placeholder: "Tech Solutions Inc." },
      { name: "date", label: "Date", type: "date" },
      { name: "content", label: "Letter Body", type: "textarea", placeholder: "Dear John, I am writing to apply for..." },
    ],
  },
  {
    id: "nda",
    name: "Non-Disclosure Agreement (NDA)",
    description: "A simple mutual NDA.",
    icon: ShieldAlert,
    fields: [
      { name: "partyA", label: "Disclosing Party", type: "text", placeholder: "Company A" },
      { name: "partyB", label: "Receiving Party", type: "text", placeholder: "Company B" },
      { name: "date", label: "Effective Date", type: "date" },
      { name: "state", label: "Governing State", type: "text", placeholder: "California" },
    ],
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    description: "Structured template for meeting minutes.",
    icon: ClipboardList,
    fields: [
      { name: "meetingTitle", label: "Meeting Title", type: "text", placeholder: "Weekly Sync" },
      { name: "date", label: "Date", type: "date" },
      { name: "attendees", label: "Attendees", type: "textarea", placeholder: "Alice, Bob, Charlie" },
      { name: "agenda", label: "Agenda", type: "textarea", placeholder: "1. Project update\n2. Q&A" },
      { name: "actionItems", label: "Action Items", type: "textarea", placeholder: "- Alice: Send report" },
    ],
  },
  {
    id: "rent-receipt",
    name: "Rent Receipt",
    description: "A simple receipt for rent payment.",
    icon: Home,
    fields: [
      { name: "tenantName", label: "Tenant Name", type: "text", placeholder: "John Doe" },
      { name: "landlordName", label: "Landlord Name", type: "text", placeholder: "Jane Smith" },
      { name: "propertyAddress", label: "Property Address", type: "text", placeholder: "123 Main St, Apt 4B" },
      { name: "amount", label: "Amount Received ($)", type: "number", placeholder: "1500.00" },
      { name: "date", label: "Date Received", type: "date" },
    ],
  },
  {
    id: "simple-contract",
    name: "Simple Contract",
    description: "A basic service agreement.",
    icon: PenTool,
    fields: [
      { name: "contractorName", label: "Contractor Name", type: "text", placeholder: "Acme Services" },
      { name: "clientName", label: "Client Name", type: "text", placeholder: "XYZ Corp" },
      { name: "serviceDescription", label: "Services Provided", type: "textarea", placeholder: "Website redesign and hosting" },
      { name: "compensation", label: "Compensation", type: "text", placeholder: "$5000 total" },
      { name: "date", label: "Date", type: "date" },
    ],
  },
  {
    id: "certificate",
    name: "Certificate of Completion",
    description: "An elegant certificate template.",
    icon: Award,
    fields: [
      { name: "recipientName", label: "Recipient Name", type: "text", placeholder: "John Doe" },
      { name: "courseName", label: "Course/Event Name", type: "text", placeholder: "Advanced React Patterns" },
      { name: "issuerName", label: "Issuer Name", type: "text", placeholder: "Frontend Academy" },
      { name: "date", label: "Date of Issue", type: "date" },
    ],
  },
];
