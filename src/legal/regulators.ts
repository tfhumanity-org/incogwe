import type { Regulator } from '../types.ts';

export const REGULATORS = {
  EDPB_LEAD: {
    name: 'Your national Data Protection Authority (EEA)',
    complaintUrl: 'https://www.edpb.europa.eu/about-edpb/about-edpb/members_en',
    jurisdiction: 'EEA',
  },
  ICO: {
    name: "UK Information Commissioner's Office",
    complaintUrl: 'https://ico.org.uk/make-a-complaint/',
    jurisdiction: 'UK',
  },
  FDPIC: {
    name: 'Swiss Federal Data Protection and Information Commissioner',
    complaintUrl: 'https://www.edoeb.admin.ch/en',
    jurisdiction: 'CH',
  },
  OPC_CA: {
    name: 'Office of the Privacy Commissioner of Canada',
    complaintUrl: 'https://www.priv.gc.ca/en/report-a-concern/',
    jurisdiction: 'CA',
  },
  CPPA: {
    name: 'California Privacy Protection Agency',
    complaintUrl: 'https://cppa.ca.gov/webapplications/complaint',
    jurisdiction: 'US-CA',
  },
  CA_AG: {
    name: 'California Attorney General',
    complaintUrl: 'https://oag.ca.gov/contact/consumer-complaint-against-business-or-company',
    jurisdiction: 'US-CA',
  },
  VA_AG: { name: 'Virginia Attorney General', complaintUrl: 'https://www.oag.state.va.us/consumer-protection/index.php/file-a-complaint', jurisdiction: 'US-VA' },
  CO_AG: { name: 'Colorado Attorney General', complaintUrl: 'https://coag.gov/file-complaint/', jurisdiction: 'US-CO' },
  CT_AG: { name: 'Connecticut Attorney General', complaintUrl: 'https://portal.ct.gov/ag/common/complaint-form-landing-page', jurisdiction: 'US-CT' },
  UT_DCP: { name: 'Utah Division of Consumer Protection', complaintUrl: 'https://dcp.utah.gov/complaints/', jurisdiction: 'US-UT' },
  TX_AG: { name: 'Texas Attorney General', complaintUrl: 'https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint', jurisdiction: 'US-TX' },
  OR_DOJ: { name: 'Oregon Department of Justice', complaintUrl: 'https://justice.oregon.gov/consumercomplaints/', jurisdiction: 'US-OR' },
  MT_DOJ: { name: 'Montana Department of Justice', complaintUrl: 'https://dojmt.gov/consumer/consumer-complaints/', jurisdiction: 'US-MT' },
  FL_AG: { name: 'Florida Attorney General', complaintUrl: 'https://www.myfloridalegal.com/consumer-protection', jurisdiction: 'US-FL' },
  DE_DOJ: { name: 'Delaware Department of Justice', complaintUrl: 'https://attorneygeneral.delaware.gov/fraud/cpu/complaint/', jurisdiction: 'US-DE' },
  NH_DOJ: { name: 'New Hampshire Department of Justice', complaintUrl: 'https://www.doj.nh.gov/consumer/complaints/', jurisdiction: 'US-NH' },
  NJ_DCA: { name: 'New Jersey Division of Consumer Affairs', complaintUrl: 'https://www.njconsumeraffairs.gov/Pages/consumer-complaint.aspx', jurisdiction: 'US-NJ' },
  MD_AG: { name: 'Maryland Attorney General', complaintUrl: 'https://www.marylandattorneygeneral.gov/Pages/CPD/complaint.aspx', jurisdiction: 'US-MD' },
  MN_AG: { name: 'Minnesota Attorney General', complaintUrl: 'https://www.ag.state.mn.us/office/complaint.asp', jurisdiction: 'US-MN' },
  TN_AG: { name: 'Tennessee Attorney General', complaintUrl: 'https://www.tn.gov/attorneygeneral/working-for-tennessee/consumer/file-a-complaint.html', jurisdiction: 'US-TN' },
  IA_AG: { name: 'Iowa Attorney General', complaintUrl: 'https://www.iowaattorneygeneral.gov/for-consumers/file-a-consumer-complaint', jurisdiction: 'US-IA' },
  IN_AG: { name: 'Indiana Attorney General', complaintUrl: 'https://www.in.gov/attorneygeneral/consumer-protection-division/file-a-complaint/', jurisdiction: 'US-IN' },
} as const satisfies Record<string, Regulator>;
