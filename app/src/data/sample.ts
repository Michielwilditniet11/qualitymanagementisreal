export const SAMPLE_CSV = `contract_id,contract_name,supplier,category,department,contract_owner,annual_value,start_date,end_date,status,renewal_notice_days,auto_renew
C001,Laptop lease fleet,TechLease BV,IT Hardware,IT,Sanne de Vries,240000,2024-01-01,2026-12-31,Active,90,yes
C002,Microsoft licensing EA,SoftServe Partners,Software,IT,Sanne de Vries,410000,2025-04-01,2028-03-31,Active,180,yes
C003,Datacenter colocation,NLDatacenters,IT Infrastructure,IT,Peter Janssen,185000,2023-06-01,2026-05-31,Active,120,no
C004,Cybersecurity SOC,SecureWatch,IT Services,IT,Peter Janssen,150000,2024-09-01,2026-08-31,Active,60,yes
C005,Office cleaning HQ,CleanCo Facility,Facility Services,Facilities,Mark Bakker,95000,2023-01-01,2025-12-31,Active,30,yes
C006,Catering services,FoodWorks,Facility Services,Facilities,Mark Bakker,120000,2024-03-01,2026-02-28,Active,60,no
C007,Building maintenance,BouwOnderhoud NL,Facility Services,Facilities,Mark Bakker,210000,2022-01-01,2025-09-30,Active,90,yes
C008,Security guarding,SecureWatch,Facility Services,Facilities,,88000,2024-01-01,2026-12-31,Active,30,no
C009,Temp staffing IT,FlexForce,Contingent Labour,HR,Lisa van Dam,320000,2025-01-01,2025-11-30,Active,30,no
C010,Recruitment RPO,TalentBridge,HR Services,HR,Lisa van Dam,140000,2024-06-01,2027-05-31,Active,90,yes
C011,Payroll processing,PayDesk,HR Services,HR,Lisa van Dam,60000,2023-01-01,2026-12-31,Active,120,yes
C012,Learning platform,SkillUp,HR Services,HR,,45000,2025-02-01,2026-01-31,Active,30,no
C013,Road freight EU,TransEuro Logistics,Logistics,Operations,Ahmed Yilmaz,520000,2024-01-01,2025-10-15,Active,120,yes
C014,Warehouse equipment,LiftMasters,Equipment,Operations,Ahmed Yilmaz,175000,2023-05-01,2027-04-30,Active,90,no
C015,Packaging materials,PackRight,Packaging,Operations,Emma Visser,260000,2025-01-01,2026-12-31,Active,60,yes
C016,Pallet supply,PackRight,Packaging,Operations,Emma Visser,90000,2025-01-01,2026-06-30,Active,30,no
C017,Marketing agency retainer,BrandBoost,Marketing Services,Marketing,Tom Hendriks,300000,2024-04-01,2025-09-30,Active,90,no
C018,Print & promo materials,PrintPro,Marketing Services,Marketing,Tom Hendriks,,2024-01-01,2026-12-31,Active,30,yes
C019,Event management,EventGurus,Marketing Services,Marketing,Tom Hendriks,110000,2025-03-01,2026-02-28,Active,60,no
C020,Legal counsel retainer,LexAdvocaten,Professional Services,Legal,Julia Smit,180000,2023-01-01,2025-12-31,Active,90,no
C021,Audit services,AuditPartners,Professional Services,Finance,Robert Chen,95000,2024-01-01,2026-12-31,Active,60,yes
C022,Insurance brokerage,RiskShield,Insurance,Finance,Robert Chen,75000,2024-01-01,2025-12-31,Active,90,no
C023,Energy supply HQ,GreenEnergy NL,Utilities,Facilities,Mark Bakker,340000,2023-01-01,2025-09-01,Expired,,no
C024,Mobile telecom,ConnectTel,Telecom,IT,Sanne de Vries,65000,2024-07-01,2026-06-30,Active,60,yes
C025,Fleet lease cars,AutoLease Plus,Fleet,Facilities,,290000,2024-01-01,2027-12-31,Active,180,no
C026,SAP support & maintenance,SoftServe Partners,Software,IT,Peter Janssen,195000,2024-01-01,2026-12-31,Active,120,yes
C027,Travel management,TravelDesk BV,Travel,Finance,Robert Chen,85000,2024-04-01,2026-03-31,Active,60,no
C028,Office supplies,OfficePro,Office Supplies,Facilities,Mark Bakker,42000,2025-01-01,2025-12-31,Active,30,yes
C029,Consulting - digital transformation,DigitalEdge,Consulting,IT,,380000,2024-06-01,2025-08-31,Active,90,no
C030,Waste management,GreenWaste NL,Facility Services,Facilities,Mark Bakker,55000,2023-06-01,2026-05-31,Active,30,no
C031,Forklift lease,LiftMasters,Equipment,Operations,Ahmed Yilmaz,120000,2024-01-01,2026-12-31,Active,90,yes
C032,Temp staffing warehouse,FlexForce,Contingent Labour,Operations,,280000,2025-03-01,2025-12-31,Active,30,no
C033,Health & safety training,SafetyFirst BV,Training,HR,Lisa van Dam,35000,2025-01-01,2025-12-31,Active,30,no
C034,Corporate communications,BrandBoost,Marketing Services,Marketing,Tom Hendriks,90000,2024-01-01,2025-11-30,Active,60,no
C035,Cloud hosting AWS,CloudStack Inc,IT Infrastructure,IT,Peter Janssen,420000,2024-01-01,2026-12-31,Active,180,yes
C036,Courier services,QuickPost,Logistics,Operations,Emma Visser,68000,2025-01-01,2026-06-30,Active,30,no
C037,Telecoms - landline,ConnectTel,Telecom,IT,Sanne de Vries,32000,2024-01-01,2026-12-31,Active,60,yes
C038,External legal - IP,LexAdvocaten,Professional Services,Legal,Julia Smit,120000,2024-06-01,2026-05-31,Active,90,no
C039,Uniforms & workwear,WorkWear BV,Uniforms,Operations,Ahmed Yilmaz,28000,2025-01-01,2025-12-31,Active,30,no
C040,Data analytics platform,DataSense AI,Software,IT,,175000,2025-01-01,2026-12-31,Active,90,yes
C041,Temp staffing - finance,FlexForce,Contingent Labour,Finance,,95000,2025-02-01,2025-11-30,Active,30,no
C042,Electricity - warehouse,GreenEnergy NL,Utilities,Operations,Emma Visser,180000,2024-01-01,2025-08-15,Expired,,no
C043,Interior plants & maintenance,GreenOffice,Facility Services,Facilities,Mark Bakker,18000,2024-01-01,2025-12-31,Active,30,yes
C044,Recruitment - executive search,TalentBridge,HR Services,HR,Lisa van Dam,75000,2025-03-01,2026-02-28,Active,60,no
C045,Customs brokerage,BorderLogistics,Logistics,Operations,Ahmed Yilmaz,92000,2024-01-01,2026-12-31,Active,90,no
C046,Fire safety systems,SafetyFirst BV,Safety Equipment,Facilities,,65000,2023-01-01,2026-12-31,Active,90,no
C047,R&D prototype materials,ProtoSupply,R&D Materials,R&D,Jan de Groot,145000,2025-01-01,2026-06-30,Active,60,no
C048,Lab equipment maintenance,LabTech Services,R&D Equipment,R&D,Jan de Groot,88000,2024-01-01,2026-12-31,Active,90,yes
C049,Patent filing services,LexAdvocaten,Professional Services,R&D,Jan de Groot,55000,2024-06-01,2026-05-31,Active,60,no
C050,Company car insurance,RiskShield,Insurance,Finance,Robert Chen,42000,2024-01-01,2025-12-31,Active,90,no
C051,Cyber insurance,RiskShield,Insurance,Finance,Robert Chen,38000,2025-01-01,2026-12-31,Active,90,no
C052,Social media management,MediaWave,Marketing Services,Marketing,,55000,2025-02-01,2025-12-31,Active,30,no
C053,Packaging design,DesignStudio,Packaging,Operations,Emma Visser,40000,2025-01-01,2025-12-31,Active,30,no
C054,Water supply,WaterWorks NL,Utilities,Facilities,Mark Bakker,22000,2023-01-01,2026-12-31,Active,,no
C055,Pension administration,PensionPlus,HR Services,HR,Lisa van Dam,48000,2024-01-01,2027-12-31,Active,120,yes`
