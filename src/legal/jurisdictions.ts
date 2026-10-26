/**
 * Legal instruments deletewe can invoke, and the clocks they start.
 *
 * SOURCING. Response periods and rights below are taken from the statutes themselves,
 * not from any competitor's material. They are a developer's reading and are marked
 * DRAFT: no letter may be sent live until an operator attests that a qualified lawyer
 * has reviewed the templates for the jurisdictions in use. See engine/sender.ts.
 */
import type { LegalInstrument, LegalInstrumentId, RegionCode } from '../types.ts';
import { REGULATORS } from './regulators.ts';

const EEA: RegionCode[] = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT',
  'LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO',
];

/** Rights available under every comprehensive US state privacy act we model. */
const US_STATE_RIGHTS = ['erasure', 'access', 'opt_out_of_sale', 'suppression'] as const;

function usState(
  id: LegalInstrumentId,
  name: string,
  shortName: string,
  region: RegionCode,
  regulator: (typeof REGULATORS)[keyof typeof REGULATORS],
  citations: Record<string, string>,
  responseDays = 45,
  extensionDays = 45,
  extraRights: readonly ('limit_sensitive' | 'objection')[] = ['limit_sensitive'],
): LegalInstrument {
  return {
    id, name, shortName,
    subjectRegions: [region],
    extraterritorial: true,
    rights: [...US_STATE_RIGHTS, ...extraRights],
    responseDays, extensionDays, citations, regulator,
    note: 'DRAFT — requires legal review before live use.',
  };
}

export const INSTRUMENTS: Readonly<Record<LegalInstrumentId, LegalInstrument>> = Object.freeze({
  GDPR: {
    id: 'GDPR',
    name: 'General Data Protection Regulation (EU) 2016/679',
    shortName: 'GDPR',
    subjectRegions: EEA,
    extraterritorial: true,
    rights: ['erasure', 'access', 'objection', 'suppression', 'limit_sensitive'],
    responseDays: 30,
    extensionDays: 60,
    citations: {
      erasure: 'Article 17 GDPR (right to erasure)',
      access: 'Article 15 GDPR (right of access)',
      objection: 'Article 21(2) GDPR (objection to direct marketing — absolute)',
      suppression: 'Article 17(2) GDPR (notification to recipients) and Article 19 GDPR',
      limit_sensitive: 'Article 9 GDPR (special categories)',
      deadline: 'Article 12(3) GDPR (one month, extendable by two further months)',
      agent: 'Article 80 GDPR (representation of data subjects)',
      complaint: 'Article 77 GDPR (right to lodge a complaint)',
    },
    regulator: REGULATORS.EDPB_LEAD,
    note: 'DRAFT — one calendar month, modelled here as 30 days. Article 12(3) permits a two-month extension on notice.',
  },
  UK_GDPR: {
    id: 'UK_GDPR',
    name: 'UK GDPR and Data Protection Act 2018',
    shortName: 'UK GDPR',
    subjectRegions: ['GB', 'UK', 'IM'],
    extraterritorial: true,
    rights: ['erasure', 'access', 'objection', 'suppression', 'limit_sensitive'],
    responseDays: 30,
    extensionDays: 60,
    citations: {
      erasure: 'Article 17 UK GDPR (right to erasure)',
      access: 'Article 15 UK GDPR (right of access)',
      objection: 'Article 21(2) UK GDPR (objection to direct marketing)',
      suppression: 'Article 19 UK GDPR',
      deadline: 'Article 12(3) UK GDPR',
      complaint: 'Section 165 Data Protection Act 2018',
    },
    regulator: REGULATORS.ICO,
    note: 'DRAFT — requires legal review before live use.',
  },
  CH_FADP: {
    id: 'CH_FADP',
    name: 'Swiss Federal Act on Data Protection (revFADP, in force 1 September 2023)',
    shortName: 'FADP',
    subjectRegions: ['CH'],
    extraterritorial: true,
    rights: ['erasure', 'access', 'objection'],
    responseDays: 30,
    extensionDays: 0,
    citations: {
      erasure: 'Article 32(2)(c) FADP (request for deletion or destruction)',
      access: 'Article 25 FADP (right of access)',
      objection: 'Article 30(2)(b) FADP (objection to disclosure to third parties)',
      deadline: 'Article 25(7) FADP (generally within 30 days)',
    },
    regulator: REGULATORS.FDPIC,
    note: 'DRAFT — the FADP sets "as a rule within 30 days"; treat the clock as indicative.',
  },
  PIPEDA: {
    id: 'PIPEDA',
    name: 'Personal Information Protection and Electronic Documents Act (Canada)',
    shortName: 'PIPEDA',
    subjectRegions: ['CA'],
    extraterritorial: false,
    rights: ['erasure', 'access', 'objection'],
    responseDays: 30,
    extensionDays: 30,
    citations: {
      access: 'Principle 4.9, Schedule 1 PIPEDA (individual access)',
      erasure: 'Principle 4.5.3, Schedule 1 PIPEDA (retention no longer than necessary)',
      objection: 'Principle 4.3.8, Schedule 1 PIPEDA (withdrawal of consent)',
      deadline: 'Section 8(3) PIPEDA (response within 30 days)',
      complaint: 'Section 11 PIPEDA (complaint to the Privacy Commissioner)',
    },
    regulator: REGULATORS.OPC_CA,
    note: 'DRAFT — PIPEDA has no free-standing erasure right; the request is framed as withdrawal of consent plus the retention principle.',
  },
  CCPA: {
    id: 'CCPA',
    name: 'California Consumer Privacy Act as amended by the CPRA',
    shortName: 'CCPA/CPRA',
    subjectRegions: ['US-CA'],
    extraterritorial: true,
    rights: ['erasure', 'access', 'opt_out_of_sale', 'suppression', 'limit_sensitive'],
    responseDays: 45,
    extensionDays: 45,
    citations: {
      erasure: 'Cal. Civ. Code § 1798.105 (right to delete)',
      access: 'Cal. Civ. Code § 1798.110 and § 1798.115 (right to know)',
      opt_out_of_sale: 'Cal. Civ. Code § 1798.120 (right to opt out of sale or sharing)',
      limit_sensitive: 'Cal. Civ. Code § 1798.121 (right to limit use of sensitive personal information)',
      suppression: 'Cal. Civ. Code § 1798.105(c) (direct service providers and third parties to delete)',
      deadline: 'Cal. Civ. Code § 1798.130(a)(2) (45 days, extendable once by a further 45)',
      agent: 'Cal. Civ. Code § 1798.140(ai) and 11 CCR § 7063 (authorised agent)',
    },
    regulator: REGULATORS.CPPA,
    note: 'DRAFT — an authorised-agent request may lawfully be met with a verification challenge to the consumer; see mailbox classifier class `needs_verification`.',
  },
  CA_DELETE_ACT: {
    id: 'CA_DELETE_ACT',
    name: 'California Delete Act (SB 362) and the DROP platform',
    shortName: 'Delete Act / DROP',
    subjectRegions: ['US-CA'],
    extraterritorial: true,
    rights: ['erasure', 'suppression', 'opt_out_of_sale'],
    responseDays: 45,
    extensionDays: 0,
    citations: {
      erasure: 'Cal. Civ. Code § 1798.99.86 (deletion via the accessible deletion mechanism)',
      suppression: 'Cal. Civ. Code § 1798.99.86(c) (ongoing deletion every 45 days)',
      deadline: 'Registered data brokers must access DROP at least every 45 days and process requests within 45 days (from 1 August 2026)',
      registry: 'Cal. Civ. Code § 1798.99.82 (data broker registration)',
    },
    regulator: REGULATORS.CPPA,
    note: 'DRAFT — for a Californian subject this should normally be exercised through the state DROP portal directly rather than by letter. deletewe emits a DROP referral alongside the letter.',
  },
  VCDPA: usState('VCDPA', 'Virginia Consumer Data Protection Act', 'VCDPA', 'US-VA', REGULATORS.VA_AG, {
    erasure: 'Va. Code § 59.1-577(A)(3) (right to delete)',
    access: 'Va. Code § 59.1-577(A)(1)',
    opt_out_of_sale: 'Va. Code § 59.1-577(A)(5)',
    deadline: 'Va. Code § 59.1-578(B) (45 days, extendable by 45)',
  }),
  CPA: usState('CPA', 'Colorado Privacy Act', 'CPA', 'US-CO', REGULATORS.CO_AG, {
    erasure: 'C.R.S. § 6-1-1306(1)(d) (right to delete)',
    access: 'C.R.S. § 6-1-1306(1)(b)',
    opt_out_of_sale: 'C.R.S. § 6-1-1306(1)(a)',
    deadline: 'C.R.S. § 6-1-1306(2)(a) (45 days, extendable by 45)',
  }),
  CTDPA: usState('CTDPA', 'Connecticut Data Privacy Act', 'CTDPA', 'US-CT', REGULATORS.CT_AG, {
    erasure: 'Conn. Gen. Stat. § 42-518(a)(3)',
    access: 'Conn. Gen. Stat. § 42-518(a)(1)',
    opt_out_of_sale: 'Conn. Gen. Stat. § 42-518(a)(5)',
    deadline: 'Conn. Gen. Stat. § 42-518(b) (45 days, extendable by 45)',
  }),
  UCPA: usState('UCPA', 'Utah Consumer Privacy Act', 'UCPA', 'US-UT', REGULATORS.UT_DCP, {
    erasure: 'Utah Code § 13-61-201(4)',
    access: 'Utah Code § 13-61-201(1)',
    opt_out_of_sale: 'Utah Code § 13-61-201(5)',
    deadline: 'Utah Code § 13-61-203(1) (45 days, extendable by 45)',
  }, 45, 45, []),
  TDPSA: usState('TDPSA', 'Texas Data Privacy and Security Act', 'TDPSA', 'US-TX', REGULATORS.TX_AG, {
    erasure: 'Tex. Bus. & Com. Code § 541.051(b)(3)',
    access: 'Tex. Bus. & Com. Code § 541.051(b)(1)',
    opt_out_of_sale: 'Tex. Bus. & Com. Code § 541.051(b)(5)',
    deadline: 'Tex. Bus. & Com. Code § 541.052(b) (45 days, extendable by 45)',
  }),
  OCPA: usState('OCPA', 'Oregon Consumer Privacy Act', 'OCPA', 'US-OR', REGULATORS.OR_DOJ, {
    erasure: 'ORS § 646A.574(1)(c)',
    access: 'ORS § 646A.574(1)(a) — including the names of specific third parties to whom data was disclosed',
    opt_out_of_sale: 'ORS § 646A.574(1)(d)',
    deadline: 'ORS § 646A.578(1) (45 days, extendable by 45)',
  }),
  MTCDPA: usState('MTCDPA', 'Montana Consumer Data Privacy Act', 'MTCDPA', 'US-MT', REGULATORS.MT_DOJ, {
    erasure: 'Mont. Code Ann. § 30-14-2812(1)(c)',
    access: 'Mont. Code Ann. § 30-14-2812(1)(a)',
    opt_out_of_sale: 'Mont. Code Ann. § 30-14-2812(1)(d)',
    deadline: 'Mont. Code Ann. § 30-14-2813(2) (45 days, extendable by 45)',
  }),
  FDBR: usState('FDBR', 'Florida Digital Bill of Rights', 'FDBR', 'US-FL', REGULATORS.FL_AG, {
    erasure: 'Fla. Stat. § 501.705(2)(c)',
    access: 'Fla. Stat. § 501.705(2)(a)',
    opt_out_of_sale: 'Fla. Stat. § 501.705(2)(d)',
    deadline: 'Fla. Stat. § 501.707(1) (45 days, extendable by 15)',
  }, 45, 15),
  DPDPA: usState('DPDPA', 'Delaware Personal Data Privacy Act', 'DPDPA', 'US-DE', REGULATORS.DE_DOJ, {
    erasure: '6 Del. C. § 12D-104(a)(3)',
    access: '6 Del. C. § 12D-104(a)(1)',
    opt_out_of_sale: '6 Del. C. § 12D-104(a)(5)',
    deadline: '6 Del. C. § 12D-104(c)(1) (45 days, extendable by 45)',
  }),
  NHPA: usState('NHPA', 'New Hampshire Data Privacy Act (SB 255)', 'NH DPA', 'US-NH', REGULATORS.NH_DOJ, {
    erasure: 'N.H. Rev. Stat. § 507-H:3(I)(c)',
    access: 'N.H. Rev. Stat. § 507-H:3(I)(a)',
    opt_out_of_sale: 'N.H. Rev. Stat. § 507-H:3(I)(d)',
    deadline: 'N.H. Rev. Stat. § 507-H:4(I) (45 days, extendable by 45)',
  }),
  NJDPA: usState('NJDPA', 'New Jersey Data Privacy Act', 'NJ DPA', 'US-NJ', REGULATORS.NJ_DCA, {
    erasure: 'N.J.S.A. § 56:8-166.7(a)(3)',
    access: 'N.J.S.A. § 56:8-166.7(a)(1)',
    opt_out_of_sale: 'N.J.S.A. § 56:8-166.7(a)(4)',
    deadline: 'N.J.S.A. § 56:8-166.8(a) (45 days, extendable by 45)',
  }),
  MODPA: usState('MODPA', 'Maryland Online Data Privacy Act', 'MODPA', 'US-MD', REGULATORS.MD_AG, {
    erasure: 'Md. Code, Com. Law § 14-4705(a)(3)',
    access: 'Md. Code, Com. Law § 14-4705(a)(1)',
    opt_out_of_sale: 'Md. Code, Com. Law § 14-4705(a)(4) — Maryland prohibits the sale of sensitive data outright',
    deadline: 'Md. Code, Com. Law § 14-4706(b) (45 days, extendable by 45)',
  }),
  MNCDPA: usState('MNCDPA', 'Minnesota Consumer Data Privacy Act', 'MN CDPA', 'US-MN', REGULATORS.MN_AG, {
    erasure: 'Minn. Stat. § 325O.05(1)(d)',
    access: 'Minn. Stat. § 325O.05(1)(b)',
    opt_out_of_sale: 'Minn. Stat. § 325O.05(1)(a)',
    deadline: 'Minn. Stat. § 325O.05(3) (45 days, extendable by 45)',
  }),
  TIPA: usState('TIPA', 'Tennessee Information Protection Act', 'TIPA', 'US-TN', REGULATORS.TN_AG, {
    erasure: 'Tenn. Code Ann. § 47-18-3203(a)(1)(C)',
    access: 'Tenn. Code Ann. § 47-18-3203(a)(1)(A)',
    opt_out_of_sale: 'Tenn. Code Ann. § 47-18-3203(a)(1)(E)',
    deadline: 'Tenn. Code Ann. § 47-18-3203(b)(1) (45 days, extendable by 45)',
  }),
  ICDPA: usState('ICDPA', 'Iowa Consumer Data Protection Act', 'ICDPA', 'US-IA', REGULATORS.IA_AG, {
    erasure: 'Iowa Code § 715D.3(1)(c)',
    access: 'Iowa Code § 715D.3(1)(a)',
    opt_out_of_sale: 'Iowa Code § 715D.3(1)(d)',
    deadline: 'Iowa Code § 715D.4(1) (90 days, extendable by 45)',
  }, 90, 45, []),
  INCDPA: usState('INCDPA', 'Indiana Consumer Data Protection Act', 'IN CDPA', 'US-IN', REGULATORS.IN_AG, {
    erasure: 'Ind. Code § 24-15-3-1(a)(3)',
    access: 'Ind. Code § 24-15-3-1(a)(1)',
    opt_out_of_sale: 'Ind. Code § 24-15-3-1(a)(5)',
    deadline: 'Ind. Code § 24-15-4-1(a) (45 days, extendable by 45)',
  }),
});

export const ALL_INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as LegalInstrumentId[];

export function instrument(id: LegalInstrumentId): LegalInstrument {
  const i = INSTRUMENTS[id];
  if (!i) throw new Error(`unknown legal instrument ${id}`);
  return i;
}

/** Is this region inside the EEA? */
export function isEea(region: RegionCode): boolean {
  return EEA.includes(region);
}

/** Every instrument a resident of `region` may personally invoke. */
export function instrumentsForResidence(region: RegionCode): LegalInstrument[] {
  return ALL_INSTRUMENT_IDS
    .map((id) => INSTRUMENTS[id])
    .filter((i) => i.subjectRegions.includes(region));
}
