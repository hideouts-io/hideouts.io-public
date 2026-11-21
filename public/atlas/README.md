# What location data can actually tell us

A Mac can hold references to cities, radio networks and places its owner has never visited. Put those references on a map and the picture looks persuasive: thousands of precise points, carrier names and identifiers. The difficult question is what each point represents.

The Local Evidence Atlas makes that question visible. It separates map resources, network-position estimates, coverage summaries and infrastructure records, then keeps each conclusion attached to its evidence. Its most useful result is an exact connection between a public NR identity and two position estimates. The remaining gap is equally specific: neither a measured PCI nor an actual installation has been established for that identity.

> **Scope:** Read-only research into retained macOS map resources and deliberately acquired public Downtown Los Angeles cellular data. The full-map research preview preserves the prepared technical catalog with only personal hardware and access information removed. The owner has authorized its research publication. Original source evidence remains private and unchanged; this README does not assert a completed hosted deployment.

[Browse all 102,274 location records](./records/index.html), or [explore the focused Downtown LA comparison](./preview/index.html). The full catalog retains every map-source row across all 12 layers, all 5,286 Flyover camera frames, the complete coverage wire data and exact PCI indexes. Details load when requested. Personal hardware and access information is removed from these prepared research copies; the complete source evidence bundle remains private. Neither view is a live radio survey.

## Run the research preview locally

This README is the canonical case-study article for this research source tree. The links above open page-source files in `site/`; run the helper to use the interactive interface with its local data requests:

```sh
python3 serve_atlas.py
```

Open the loopback URL printed by the helper. It selects an available port and serves only `site/`, including the full catalog at `/records/` and the focused comparison at `/preview/`. Press Ctrl-C to stop it. Python 3.10 or later is required; no packages, account, external request or device access is needed by the helper.

## Source rights and publication status

The owner has selected the full-data research release and states that it explains the system on personally owned consumer hardware. That is the owner's asserted research-publication basis, not an independently verified vendor redistribution license or endorsement. The prepared full map, original analysis and interface proceed under that authorization while source-specific terms and their applicability remain clearly identified. Original frontend code, the local helper and original prose are offered under the scoped [MIT License](./LICENSE.txt); all third-party data and assets are excluded from that grant. [Data notices](./DATA-NOTICES.md) provide the canonical source-family attributions, applicable licenses, changes and unresolved terms. Hosting status remains separate from source readiness.

## Start with the source

The private research snapshot contains **102,274 heterogeneous rows across 12 layers**. Of those, 102,272 have display coordinates and two remain unmapped. A separate special payload has no geographic position. These are record counts, not a count of towers, devices or visits.

| Source | Retained records | What a position means |
| --- | ---: | --- |
| Regional LTE positioning file | 38,511 | Returned cell-position estimate; includes 76 unknown-cell sentinels |
| Public NR response | 100 | Returned NR cell-position estimate |
| `CELLULAR_COVERAGE_PLMN` | 60,168 | Derived coverage-grid center and bounds |
| Raw coverage outliers | 6 | Grid context containing an unusual raw PCI value |
| Flyover tours / catalog | 334 / 1,432 | Virtual camera or map-resource anchor |
| Public Wi-Fi response | 400 | Returned access-point position estimate |
| City small-cell / permit records | 915 / 405 | Published pole location or administrative reference point |
| Separately sourced LTE / NR estimates | 1 / 1 | Exact-identity provider estimates |
| Engineering-plan text | 1 | Documentary planned position; deliberately unplotted |

The local GeoServices files were resource catalogs. The regional cellular data was acquired deliberately for research. The NR request used the public Downtown LA point **34.05, -118.25** and technology value **256**. It supplied no private location records, credentials, cookies or device identifiers. Its response contained 100 NR records and 400 Wi-Fi estimates, despite requesting zero surrounding Wi-Fi records. That is a saved service response, not a scan performed by the Mac.

The historical acquisition locators are Apple ALS Nearby (`https://gs-loc.apple.com/clls/wloc`), using ARPC function **3** and NR technology **256**, the unsigned regional LTE file (`https://cl2.apple.com/4/v1/124/60/1240000_0600000_0000000001360104.gz`), and the CELLULAR_COVERAGE_PLMN style-94 response (`https://gspe79-ssl.ls.apple.com/ccc/v1/94/1230549`). These links identify the saved sources; the preview uses retained local data and makes no requests to these endpoints. Direct-feed reuse terms and their applicability remain unresolved.

The protected `tiles_cell` cache remained unexported. The coverage layer came from the saved public response, not that cache. An access limit says nothing about inaccessible contents.

## Read the identifiers before connecting the dots

**MCC/MNC** identifies a mobile network assignment. The Atlas labels **310/260 as T-Mobile**, **310/410 as AT&T** and **311/480 as Verizon**, while preserving the original codes. These names help searching; they do not establish ownership of nearby equipment or a subscriber’s retail brand. Assignments and dates are retained separately. [US IMSI Administrator assignments](https://imsiadmin.com/assignments/hni/).

**ECI** is the full LTE cell identity; **NCI** is its NR counterpart. NCI has 36 bits, whereas LTE ECI has 28. A full NR identity is interpreted with its PLMN, rather than as an isolated number. **TAC** identifies a tracking area, not an antenna. [ETSI TS 23.003, clauses 19.4.2.9.3, 19.6 and 19.6A](https://www.etsi.org/deliver/etsi_ts/123000_123099/123003/19.08.00_60/ts_123003v190800p.pdf).

**PCI** is a reusable physical-layer identity. NR has 1,008 possibilities. **NRARFCN** identifies the radio channel. A PCI plus a carrier and channel narrows context but does not uniquely locate a cell or site. [ETSI TS 38.211, clause 7.4.2.1](https://www.etsi.org/deliver/etsi_ts/138200_138299/138211/18.10.00_60/ts_138211v181000p.pdf).

This distinction explains why **2,648,582 coverage PCI references** do not mean that many towers. References repeat across grids, networks and channels.

## The Downtown LA case: one identity, two estimates

The selected case uses **NR 310/260, TAC 3960320, NCI 7587668269**. The NCI’s hexadecimal form is **0x1C442A12D**. The retained Apple row supplies **NRARFCN 501390**; the comparison provider did not return a channel.

| Source | Latitude | Longitude | Source-specific uncertainty |
| --- | ---: | ---: | --- |
| Apple public NR estimate | 34.05365371 | -118.25823211 | Horizontal accuracy: 1,414 m |
| OpenCellID-derived mirror | 34.0538 | -118.2575 | Provider range: 1,000 m; no horizontal accuracy supplied |

The exact radio/MCC/MNC/TAC/NCI tuple associates both records with the same identity. Their displayed centers are **69.38 m apart**. That is a reproducible estimate comparison, not independent confirmation of an antenna coordinate. The mirror attributes its data to [OpenCellID](https://opencellid.org/); possible shared upstream provenance limits the sources’ independence. Its range describes coverage metadata, not an interchangeable accuracy radius.

The OpenCellID-derived cell data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with [OpenCellID attribution requirements](https://wiki.opencellid.org/docs/attribution). This study selects public-area records, normalizes field labels and adds comparisons and context; the displayed estimate coordinates retain the source digits without rounding. This attribution does not clear the separate Apple-feed, mirror-service or City-data reuse questions.

The mirror’s `unit`/PCI field is null. Its first/last dates describe provider database history, not somebody’s movements. Nine reported samples are not nine independently verified observations.

At the Apple center, coverage grid **C59904** contains same-network, same-channel PCIs **42 and 842**. At the provider center, **C59666** contains **42 and 866**. Their shared **42 remains unassigned**: it occurs in **76 retained grids**, including 11 in the public study. The Apple uncertainty circle intersects 440 qualifying grids containing 145 distinct PCIs. There is no supported rule that assigns whichever PCI overlaps both estimate centers to this NCI.

Decimal places do not repair that gap. Neither proximity, a shared carrier nor an overlapping coverage area establishes a physical-site link.

## What the parser resolved

Static examination of the retained native `awd.metrics.CellularCoverageTile` parser in the audited iOS 27.2.1 build 24B156 traced **nine reachable message types and 34 declared fields**. Reader, writer and independent converter/printer evidence established the important distinction:

- LTE **tag 5** is a repeated nested PCI message.
- NR **tag 6** is a repeated nested PCI message.
- NR **tag 5** is `RedCapInfo`, with configuration and count fields.

These human-readable labels come from native consumer evidence; the official `.proto` variable names were not recovered. The recognized coverage graph contains network, channel, band, counts, signal and PCI information, but no full ECI, full NCI, TAC or antenna-coordinate field. It therefore cannot supply the missing identity-to-site join. Unknown-field skipping also prevents treating this bounded schema as a claim about every possible future message.

Splitting NCI into a gNB prefix is another distinct problem. Standards allow a 22–32-bit gNB ID, so the target yields 11 possible arithmetic splits until the operator’s actual length is established. No split selects a PCI or coordinate; a logical gNB can also have distributed components. [ETSI TS 38.413, clauses 9.3.1.6–7](https://www.etsi.org/deliver/etsi_ts/138400_138499/138413/19.01.00_60/ts_138413v190100p.pdf), [ETSI TS 38.401](https://www.etsi.org/deliver/etsi_ts/138400_138499/138401/19.02.00_60/ts_138401v190200p.pdf).

## What could establish the missing links?

Two evidence routes matter. A dated radio observation carrying PLMN, full NCI, TAC, PCI and channel together could support the **identity-to-PCI** relationship. Its GPS would describe the receiver’s position, not the antenna.

The open-source Network Survey format can represent those fields together; its pinned Android implementation and CSV writer preserve full NCI values and leave unavailable fields blank. This establishes a useful acquisition contract, not a measurement of the target. No matching export was obtained and no app was installed or survey started. [Pinned messaging schema](https://raw.githubusercontent.com/christianrowlands/network-survey-messaging/004c43174917eb64e50b74d9679466bf86fe8ca7/src/main/asyncapi/network_survey_messaging.yaml), [Android record construction](https://github.com/christianrowlands/android-network-survey/blob/511d2d2ae575d0be9bc269f65035d6cbb1274740/networksurvey/src/main/java/com/craxiom/networksurvey/services/SurveyRecordProcessor.java#L1909).

A dated authoritative crosswalk connecting the full identity to a specific installation could independently support the **identity-to-site** relationship, even without measured PCI. Municipal records offer a documentary route: current LA application instructions require antenna/cabinet coordinates and plans. Requirements alone do not identify this target, prove completion or establish current operation. [LA City Planning CP13-7849, pages 5–6](https://planning.lacity.gov/odocument/99300853-2fad-4e37-99d0-3cf891b5585a/Wireless%20Telecommunications%20Facilities%20-%20Administrative%20Review%20Instructions.pdf).

The reviewed evidence contains **zero supported measured PCI-to-full-identity links and zero independently verified full-identity-to-installation links**. Those are findings about this evidence set, not claims that sites or links do not exist.

## Why this belongs on an ordinary computer

Location systems need databases that relate surrounding radio infrastructure to places. Apple describes using crowdsourced hotspot and cellular positions for positioning and describes supported iPhone contributions to that database. Those are published platform policies, not proof that this Mac contributed data or connected to these cells. Flyover resource locations likewise describe virtual map content, not visits. [Apple Location Services & Privacy](https://www.apple.com/legal/privacy/data/en/location-services/), [Apple Maps & Privacy](https://www.apple.com/legal/privacy/data/en/apple-maps/).

Location records deserve scrutiny: observations joined to time, a device or an account can reveal movement. This study does not establish that join, an unauthorized observer or remote control. No actual observation time was established for the mapped rows; acquisition and database dates must stay distinct from events.

The preview retains real public-test coordinates, identifiers, field names and limitations. It excludes private histories, Wi-Fi hardware addresses, credentials and personal machine/account metadata. The original evidence remains unredacted and unchanged. The interface preserves source attribution, exact technical values and coordinate-role explanations. No settings were changed and all serial devices were left closed. The authorized full-map research release retains the source-family qualifications in [Data notices](./DATA-NOTICES.md).
