import { SECTION_BY_ID } from "../data";
import type { FieldDefinition, SectionId } from "../types";

const ADDITIONAL_DATA: FieldDefinition = {
  key: "additionalData",
  label: "Additional Data",
  kind: "textarea",
  placeholder: "Other information from this record that does not fit the fields above",
  wide: true,
};

const normalized = (value: string) => value.trim().toLocaleLowerCase();
const commonDocumentFields = ["title", "type", "name", "documentNumber", "issueDate", "expiryDate", "member", "phone", "address", "notes"];

function documentKeys(type: string): string[] {
  const value = normalized(type);
  if (/\b(cv|resume)\b/.test(value)) return ["title", "type", "targetRole", "email", "phone", "location", "portfolio", "summary", "experience", "education", "skills", "notes"];
  if (value.includes("student")) return ["title", "type", "institutionName", "studentName", "fatherName", "motherName", "dateOfBirth", "studentId", "roll", "registrationNumber", "phone", "address", "institutionAddress", "program", "year", "issueDate", "expiryDate", "notes"];
  if (value.includes("nid") || value.includes("national id") || value.includes("national identity")) return ["title", "type", "name", "documentNumber", "dateOfBirth", "fatherName", "motherName", "address", "issueDate", "expiryDate", "bloodGroup", "member", "phone", "notes"];
  if (value.includes("passport")) return ["title", "type", "name", "documentNumber", "passportType", "nationality", "dateOfBirth", "placeOfBirth", "issueDate", "expiryDate", "member", "notes"];
  if (value.includes("birth certificate")) return ["title", "type", "name", "documentNumber", "dateOfBirth", "fatherName", "motherName", "address", "issueDate", "member", "notes"];
  if (value.includes("job id") || value.includes("employee")) return ["title", "type", "name", "employeeId", "employer", "jobTitle", "department", "phone", "issueDate", "expiryDate", "member", "notes"];
  if (value.includes("driving") || value.includes("licen")) return ["title", "type", "name", "documentNumber", "licenseClass", "dateOfBirth", "bloodGroup", "address", "issueDate", "expiryDate", "phone", "notes"];
  if (value.includes("tax") || value.includes("tin")) return ["title", "type", "name", "documentNumber", "taxOffice", "address", "issueDate", "phone", "notes"];
  if (value.includes("visa")) return ["title", "type", "name", "passportNumber", "visaNumber", "country", "visaType", "dateOfBirth", "issueDate", "expiryDate", "notes"];
  if (value.includes("residence")) return ["title", "type", "name", "permitNumber", "nationality", "address", "issueDate", "expiryDate", "phone", "notes"];
  if (value.includes("work permit")) return ["title", "type", "name", "permitNumber", "employer", "jobTitle", "passportNumber", "country", "issueDate", "expiryDate", "notes"];
  if (value.includes("health card")) return ["title", "type", "name", "insurer", "memberId", "policyNumber", "phone", "address", "issueDate", "expiryDate", "notes"];
  if (value.includes("insurance")) return ["title", "type", "name", "insurer", "policyNumber", "policyType", "coverage", "startDate", "expiryDate", "phone", "address", "notes"];
  if (value.includes("certificate")) return ["title", "type", "name", "documentNumber", "issuingAuthority", "issueDate", "expiryDate", "member", "notes"];
  if (value.includes("contract")) return ["title", "type", "partyName", "employer", "contractNumber", "startDate", "expiryDate", "phone", "address", "notes"];
  if (!value) return ["title", "type", "documentNumber", "issueDate", "expiryDate", "member", "phone", "location", "notes"];
  return commonDocumentFields;
}

export function editorFieldsFor(sectionId: SectionId, selectedType = "", accountKind = "", financeType = "", materialType = ""): FieldDefinition[] {
  const base = SECTION_BY_ID[sectionId].fields;
  let keys: string[] | null = null;
  const type = normalized(selectedType);

  if (sectionId === "documents") keys = documentKeys(selectedType);
  else if (sectionId === "academics") {
    keys = type.includes("admission")
      ? ["title", "type", "institution", "studentName", "fatherName", "motherName", "dateOfBirth", "studentId", "roll", "registrationNumber", "phone", "address", "institutionAddress", "program", "admissionSession", "applicationNumber", "paymentAmount", "paymentDate", "notes"]
      : ["title", "type", "institution", "year", "grade", "program", "notes"];
  } else if (sectionId === "accounts") {
    keys = normalized(accountKind) === "bank account"
      ? ["title", "accountKind", "bankName", "accountHolder", "bankAccountType", "accountNumber", "currency", "branch", "routingNumber", "swiftCode", "iban", "mobileBanking", "website", "notes"]
      : ["title", "accountKind", "accountType", "username", "email", "website", "registered", "status", "notes"];
  } else if (sectionId === "memberships") {
    keys = type.includes("student")
      ? ["title", "type", "organization", "studentName", "studentId", "program", "memberId", "startDate", "expiryDate", "level", "phone", "address", "website", "notes"]
      : type.includes("gym")
        ? ["title", "type", "organization", "memberId", "startDate", "expiryDate", "level", "phone", "website", "notes"]
        : ["title", "type", "organization", "memberId", "startDate", "expiryDate", "level", "website", "notes"];
  } else if (sectionId === "study") {
    const material = normalized(materialType);
    keys = material === "link"
      ? ["title", "course", "subject", "materialType", "sourceUrl", "semester", "tags", "notes"]
      : ["title", "course", "subject", "chapter", "materialType", "author", ...(material === "book" || material === "research paper" ? ["publisher", "publicationDate", "sourceUrl"] : []), "semester", "tags", "notes"];
  } else if (sectionId === "personal-finance") {
    const common = ["title", "financeType", "amount", "currency", "notes"];
    if (financeType === "income" || financeType === "expense") keys = ["title", "financeType", "amount", "currency", "transactionDate", "category", "counterparty", "accountReference", "notes"];
    else if (financeType === "loan") keys = ["title", "financeType", "amount", "currency", "transactionDate", "counterparty", "accountReference", "dueDate", "interestRate", "notes"];
    else if (financeType === "asset") keys = ["title", "financeType", "amount", "currency", "transactionDate", "assetType", "accountReference", "notes"];
    else keys = common;
  }

  const fields = keys ? base.filter((field) => keys!.includes(field.key)) : base;
  const adjusted = sectionId === "documents" ? fields.map((field) => {
    if (field.key !== "documentNumber") return field;
    const label = type.includes("nid") || type.includes("national id") || type.includes("national identity") ? "NID number"
      : type.includes("passport") ? "Passport number"
        : type.includes("birth certificate") ? "Certificate number"
          : type.includes("driving") || type.includes("licen") ? "Licence number"
            : type.includes("tax") || type.includes("tin") ? "Tax ID / TIN"
              : field.label;
    return { ...field, label };
  }) : fields;

  // Payment-card data remains deliberately restricted to the masked card fields accepted by the API.
  return sectionId === "wallet-cards" ? adjusted : [...adjusted, ADDITIONAL_DATA];
}

export function matchDocumentTypeSuggestion(suggestion: string, options: string[]): string | undefined {
  const value = normalized(suggestion);
  const direct = options.find((option) => normalized(option) === value);
  if (direct) return direct;
  const pattern = value.includes("student") ? /student/ : value.includes("nid") || value.includes("national id") || value.includes("national identity") ? /(nid|national id|national identity)/
    : value.includes("passport") ? /passport/ : value.includes("birth") ? /birth certificate/ : value.includes("driving") || value.includes("licen") ? /(driving|licen)/
      : value.includes("visa") ? /visa/ : value.includes("insurance") ? /insurance/ : value.includes("tax") || value.includes("tin") ? /(tax|tin)/ : null;
  return pattern ? options.find((option) => pattern.test(option.toLocaleLowerCase())) : undefined;
}
