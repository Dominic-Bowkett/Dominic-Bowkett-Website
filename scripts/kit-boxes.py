"""Backfill "Kit for this job" boxes into the cost guides.

Each cost guide gets one <aside class="kit-box"> immediately before its closing <hr/>,
listing 3-5 products drawn from the existing Field Kit guides (top pick, price, link to
the full guide) or, where no guide exists yet, a plain Amazon search link in the same
affiliate format. Idempotent: a guide that already contains a kit-box is skipped.

Run from the repo root:  python scripts/kit-boxes.py
"""
from __future__ import annotations

import glob
import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURNAL = os.path.join(ROOT, "public", "journal")
CSS_V = "20260909"

AMZ = ("https://www.amazon.co.uk/s?k={k}&linkCode=ll2&tag=opeconltd-21"
       "&linkId=82f351c719c3e9b898aac4324778e6cd&ref_=as_li_ss_tl")


# --------------------------------------------------------------------------- #
# product sources
# --------------------------------------------------------------------------- #
def strip(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def load_guides() -> dict:
    """Top pick name / href / price for every published best-* guide."""
    out = {}
    for path in sorted(glob.glob(os.path.join(JOURNAL, "best-*", "index.html"))):
        slug = os.path.basename(os.path.dirname(path))
        s = open(path, encoding="utf-8").read()
        top = re.search(r'<div class="top-pick">(.*?)<a class="buy" href="([^"]+)"', s, re.S)
        if not top:
            continue
        blk, href = top.group(1), html.unescape(top.group(2))
        name = re.search(r"<h3>(.*?)</h3>", blk, re.S)
        price = re.search(r'<p class="price-note">(.*?)</p>', blk, re.S)
        out[slug] = {
            "name": strip(name.group(1)) if name else slug,
            "href": href,
            "price": strip(price.group(1)) if price else "",
        }
    return out


def G(slug: str, why: str) -> dict:
    """An item drawn from an existing guide's top pick."""
    return {"guide": slug, "why": why}


def A(name: str, search: str, why: str) -> dict:
    """An item with no guide yet: a plain Amazon search link."""
    return {"name": name, "search": search, "why": why}


# --------------------------------------------------------------------------- #
# the mapping: cost guide -> intro + items
# Text is HTML: use entities (&pound; &mdash; &rsquo;) rather than raw characters.
# --------------------------------------------------------------------------- #
MAP = {
    "air-source-heat-pump-cost": (
        "A heat pump quote is only as good as the fabric survey behind it. This is the kit that tells you whether the house is ready for low-flow-temperature heating before anyone measures up for a unit.",
        [
            G("best-hygrometers", "Log temperature and humidity in the coldest room for a fortnight first."),
            G("best-infrared-thermometers", "Spot-check radiator flow and return temperatures, and the cold patches on external walls."),
            G("best-thermal-imaging-cameras", "See where the insulation isn&rsquo;t before you size the heat pump."),
            A("Tado Smart Radiator Thermostat starter kit", "Tado Smart Radiator Thermostat Starter Kit", "Room-by-room control is what makes low flow temperatures liveable."),
        ]),
    "asbestos-survey-cost": (
        "If you&rsquo;re opening up anything built before 2000 while the survey report is still pending, this is the minimum I&rsquo;d want on the person doing it.",
        [
            G("best-respirator-masks", "FFP3 is the only grade that counts around asbestos-adjacent dust."),
            A("Tyvek disposable coveralls", "DuPont Tyvek 500 Xpert disposable coverall", "Worn once, bagged, binned."),
            A("Asbestos sample test kit", "asbestos test kit UK sampling lab", "A lab-analysed kit for one suspect material; not a substitute for a survey."),
            G("best-head-torches", "Lofts and service voids are where most of it hides."),
        ]),
    "basement-conversion-cost": (
        "Before the waterproofing quotes, understand how wet the space already is. These are the instruments that give you a baseline.",
        [
            G("best-damp-meters", "Map the walls before anyone tanks them."),
            G("best-hygrometers", "A month of humidity readings says more than one visit."),
            G("best-dehumidifiers", "Holds a cellar dry while you decide, and afterwards."),
            A("Submersible sump pump with float switch", "submersible sump pump automatic float switch", "The pump most cavity-drain waterproofing systems depend on."),
            G("best-crack-monitors", "Any crack you&rsquo;ll be excavating next to gets a tell-tale first."),
        ]),
    "cavity-wall-insulation-cost": (
        "The question with cavity insulation is what&rsquo;s already in the cavity. This is the kit that answers it without waiting for a contractor&rsquo;s opinion.",
        [
            G("best-borescopes", "Look into the cavity through a drilled mortar joint."),
            G("best-damp-meters", "Map any damp on the inner leaf before you blame the fill."),
            G("best-thermal-imaging-cameras", "Patchy fill shows up as a patchwork on a cold morning."),
            G("best-hygrometers", "Condensation and cavity damp look alike on a wall; humidity readings separate them."),
        ]),
    "chimney-removal-cost": (
        "Whether you take the stack down or keep it, some kit earns its place either way.",
        [
            A("Chimney Balloon draught excluder", "Chimney Balloon draught excluder", "If the fireplace stays, this stops it heating the sky."),
            G("best-crack-monitors", "Tell-tales either side of a removed breast, read for a year."),
            G("best-sds-drills", "A breast removal is a masonry job; hire or buy."),
            G("best-respirator-masks", "Soot and old lime dust are FFP3 territory."),
            A("Cotton twill dust sheets", "cotton twill dust sheets 12ft x 9ft", "The room will not be clean for a fortnight otherwise."),
        ]),
    "conservatory-cost": (
        "A conservatory lives or dies on temperature and condensation. The cheap way to find out how yours behaves is to measure it.",
        [
            G("best-hygrometers", "Log winter humidity; the dew point tells you why the glass streams."),
            G("best-infrared-thermometers", "Roof and glazing surface temperatures on a cold night."),
            G("best-laser-measures", "Floor area for the permitted development limits, in seconds."),
            G("best-dehumidifiers", "The honest fix for a conservatory used as a drying room."),
        ]),
    "damp-proofing-cost": (
        "Most of the &ldquo;rising damp&rdquo; I&rsquo;m shown is condensation. Before you pay for an injection, a few days with the right instruments will usually tell you which it is.",
        [
            G("best-damp-meters", "A pin and pinless meter to map where the wall is actually wet."),
            G("best-hygrometers", "A Bluetooth hygrometer in the worst room for a fortnight."),
            G("best-dehumidifiers", "If the numbers say condensation, this is the treatment."),
            G("best-mould-test-kits", "When you need to know what the black stuff is."),
            A("Nuaire Drimaster Eco PIV unit", "Nuaire Drimaster Eco", "Positive input ventilation: the whole-house answer to condensation."),
        ]),
    "damp-survey-cost": (
        "This is what a damp survey uses. None of it replaces the diagnosis, but it shows what you&rsquo;re paying for.",
        [
            G("best-damp-meters", "The instrument the whole survey turns on."),
            G("best-hygrometers", "Relative humidity and dew point in every room."),
            G("best-borescopes", "Into the cavity, under the floor, behind the skirting."),
            G("best-thermal-imaging-cameras", "Cold spots and leaks the meter can&rsquo;t reach."),
            G("best-mould-test-kits", "Identifies what&rsquo;s growing when that matters to the advice."),
        ]),
    "double-glazing-cost": (
        "Before replacing windows for draughts and condensation, prove that&rsquo;s what&rsquo;s wrong. A few pounds of kit often changes the answer.",
        [
            G("best-smoke-pens", "Find the draught; it is rarely the glazing unit itself."),
            G("best-hygrometers", "Streaming windows are a humidity problem first."),
            G("best-infrared-thermometers", "Glass surface temperatures, old versus new, in one evening."),
            A("Secondary glazing film kit", "window insulation film secondary glazing kit", "The &pound;15 test of whether better glass would help."),
            A("Door and window draught strip", "Stormguard draught excluder strip", "The cheapest heat you&rsquo;ll ever save."),
        ]),
    "drainage-survey-cost": (
        "You can do a lot of your own drain investigation before paying for a CCTV survey.",
        [
            G("best-manhole-keys", "Lifting the covers is step one."),
            G("best-drain-rods", "Clearing and probing; the plunger head tells you a lot."),
            A("Drain inspection camera, 20m", "drain inspection camera 20m", "A consumer camera finds displaced joints and roots; it won&rsquo;t grade the pipe."),
            G("best-work-gloves", "For obvious reasons."),
        ]),
    "drone-survey-cost": (
        "If you&rsquo;d rather look at the roof yourself first, these are the ways up without scaffolding or a ladder.",
        [
            G("best-drones-roof-inspections", "Sub-250g means the lightest regulatory load."),
            G("best-binoculars-roof-inspections", "8x42 from the garden finds slipped tiles and failed pointing."),
            A("Telescopic inspection camera pole", "telescopic inspection camera pole", "A phone on a pole for gutters, parapets and flat roofs."),
            G("best-roof-ladders", "If you must go up, a hook ladder is the only safe way onto a pitched roof."),
        ]),
    "eicr-cost": (
        "You can&rsquo;t do your own EICR, but you can find the obvious faults before the electrician does, and understand the report afterwards.",
        [
            G("best-socket-testers", "Loop-check every socket in ten minutes."),
            G("best-voltage-testers", "Prove dead before you touch anything."),
            G("best-cable-detectors", "Where the cables run before you drill."),
            G("best-multimeters", "Continuity and a sanity check on the earth."),
            A("VDE insulated screwdriver set", "VDE insulated screwdriver set 1000V", "The only screwdrivers that belong near a consumer unit."),
        ]),
    "epc-cost": (
        "The cheap EPC points are the ones you can do yourself before the assessor arrives.",
        [
            A("LED bulbs, warm white, E27 and B22", "LED bulbs warm white E27 pack", "Low-energy lighting is an EPC line item; do every fitting."),
            A("Hot water cylinder jacket, 80mm", "hot water cylinder jacket 80mm", "An unlagged cylinder costs points and money."),
            G("best-hygrometers", "Know the house before you improve it."),
            G("best-laser-measures", "Floor areas for your own sanity check of the certificate."),
        ]),
    "external-wall-insulation-cost": (
        "Solid-wall insulation only works on a wall that is dry and sound. Check both first.",
        [
            G("best-damp-meters", "Any damp locked behind EWI gets worse, not better."),
            G("best-thermal-imaging-cameras", "Find the cold bridges the render will need to detail around."),
            G("best-infrared-thermometers", "Surface temperatures for condensation risk."),
            G("best-hygrometers", "The internal humidity the wall will have to cope with."),
        ]),
    "fire-risk-assessment-cost": (
        "Whether or not you need a formal assessment, these are the items every let should have. They cost less than the assessment.",
        [
            A("FireAngel Pro Connected smoke alarm", "FireAngel Pro Connected Smoke Alarm", "Interlinked, sealed ten-year battery; the standard the regulations point at."),
            A("FireAngel Pro Connected heat alarm", "FireAngel Pro Connected Heat Alarm", "For the kitchen, where a smoke alarm gets silenced."),
            G("best-carbon-monoxide-detectors", "Required in any room with a fixed combustion appliance."),
            A("Fire blanket, 1m x 1m", "fire blanket 1m x 1m kitchen BS EN 1869", "Kitchen wall, by the door, not by the hob."),
            A("Home fire extinguisher", "Kidde home fire extinguisher", "HMO common parts especially."),
        ]),
    "garage-conversion-cost": (
        "Garages are cold, damp boxes on a thin slab. Measure before you convert.",
        [
            G("best-damp-meters", "The slab and the lower courses, on a garage that&rsquo;s seen a few winters."),
            G("best-hygrometers", "Humidity once the door is sealed up is the number that matters."),
            G("best-laser-measures", "Floor area and headroom before the drawings."),
            G("best-thermal-imaging-cameras", "An existing conversion without sign-off usually shows its shortcuts here."),
            G("best-dehumidifiers", "For the first winter, while the slab dries."),
        ]),
    "gas-safety-certificate-cost": (
        "The gas safety check is the engineer&rsquo;s job. These are the things around it that are yours.",
        [
            G("best-carbon-monoxide-detectors", "One per room with an appliance; the regulations require it."),
            G("best-gas-leak-detectors", "A &pound;25 sniffer settles the &ldquo;can you smell gas&rdquo; argument."),
            A("FireAngel Pro Connected smoke alarm", "FireAngel Pro Connected Smoke Alarm", "Smoke alarms on every storey, under the same regulations."),
            A("FireAngel Pro Connected heat alarm", "FireAngel Pro Connected Heat Alarm", "For the kitchen and boiler cupboard."),
        ]),
    "guttering-replacement-cost": (
        "Half the &ldquo;gutter replacement&rdquo; quotes I see are for gutters that needed clearing. Check before you commit.",
        [
            G("best-gutter-vacuums", "Clear from the ground and see what comes out."),
            G("best-binoculars-roof-inspections", "Sagging brackets and open joints, from the garden."),
            G("best-telescopic-ladders", "For the sections you need to see close up."),
            A("Hedgehog gutter brush", "Hedgehog gutter brush 4m", "Keeps the leaves out once it&rsquo;s clear."),
            A("Ladder stand-off bracket", "ladder stand-off bracket", "So the ladder rests on the wall, not on the gutter you&rsquo;re inspecting."),
        ]),
    "house-rewiring-cost": (
        "You&rsquo;ll know a lot about the state of the wiring before the electrician quotes if you spend an hour with these.",
        [
            G("best-socket-testers", "Loop and polarity on every socket."),
            G("best-voltage-testers", "Prove dead, every time."),
            G("best-cable-detectors", "Find the runs before you assume they&rsquo;re chased in."),
            G("best-multimeters", "Continuity, and a sanity check on the earth."),
            G("best-extension-leads", "An RCD lead for anything you plug into a suspect circuit."),
        ]),
    "house-survey-cost": (
        "A survey is my job. But what you take to the second viewing decides whether you need the expensive one.",
        [
            G("best-damp-meters", "A pinless meter swept across the ground-floor walls."),
            G("best-head-torches", "Lofts, cupboards, under the stairs."),
            G("best-laser-measures", "Check the floor areas on the listing."),
            G("best-binoculars-roof-inspections", "The roof, from the road."),
            G("best-spirit-levels", "Floors and cills that aren&rsquo;t level are worth a question."),
        ]),
    "japanese-knotweed-survey-cost": (
        "If you&rsquo;re treating rather than surveying, this is the minimum kit. If you&rsquo;re selling, get the survey.",
        [
            A("Roundup Tree Stump &amp; Root Killer", "Roundup Tree Stump and Root Killer", "The glyphosate product for stem injection and foliar spray; it takes seasons, not weeks."),
            G("best-work-gloves", "Glyphosate and knotweed sap both want a barrier."),
            G("best-measuring-wheels", "Map the stand and its distance from the building; the 7m line matters to lenders."),
            A("Heavy-duty rubble sacks", "heavy duty rubble sacks", "Cut material is controlled waste; it doesn&rsquo;t go in the green bin."),
        ]),
    "legionella-risk-assessment-cost": (
        "Most single lets can be assessed by the landlord. This is all the equipment that takes.",
        [
            A("Digital probe thermometer", "ETI digital probe thermometer", "Hot outlets above 50&deg;C within a minute, cold below 20&deg;C; write it down."),
            G("best-infrared-thermometers", "Cylinder and pipework surface temperatures without opening anything."),
            A("Replacement shower head", "shower head replacement chrome", "Descale or replace little-used shower heads quarterly; the cheapest control on the list."),
        ]),
    "listed-building-consent-cost": (
        "Old buildings reward understanding before intervention. Two instruments and one book cover most of it.",
        [
            A("The Old House Handbook (Hunt &amp; Suhr)", "The Old House Handbook Roger Hunt Marianne Suhr", "The SPAB-endorsed primer on breathable fabric; read it before you brief anyone."),
            G("best-damp-meters", "Map the walls before anyone proposes tanking or a chemical DPC."),
            G("best-hygrometers", "Humidity in a solid-walled house explains most of its stains."),
        ]),
    "loft-conversion-cost": (
        "Headroom and structure decide whether a loft conversion is worth pricing. Measure both before the architect.",
        [
            G("best-loft-ladders", "Proper access is the first thing a converted loft needs anyway."),
            G("best-laser-measures", "Ridge-to-joist height in one press; 2.2m is the line."),
            G("best-digital-angle-finders", "Roof pitch decides how much of that floor area you keep."),
            G("best-head-torches", "Nothing in a loft is lit."),
            G("best-respirator-masks", "Insulation and decades of dust."),
        ]),
    "loft-insulation-cost": (
        "Loft insulation is the one job in this series I&rsquo;d tell most people to do themselves. This is what it takes.",
        [
            A("Knauf Earthwool Loft Roll 44, 200mm", "Knauf Earthwool Loft Roll 44 200mm", "Top up to 270mm: two layers, the second laid across the joists."),
            A("LoftZone StoreFloor loft boarding kit", "LoftZone StoreFloor loft boarding", "Raised boarding so storage doesn&rsquo;t crush the insulation."),
            G("best-knee-pads", "You&rsquo;ll be on the joists for hours."),
            G("best-respirator-masks", "FFP3 for mineral wool."),
            G("best-head-torches", "Both hands free, and you&rsquo;ll need them."),
        ]),
    "measured-building-survey-cost": (
        "For a small house or a single extension, you can measure it yourself to a standard an architect can work from.",
        [
            G("best-laser-measures", "Bluetooth to a floor-plan app; a Disto pays for itself on one job."),
            G("best-measuring-wheels", "External and plot dimensions."),
            G("best-digital-angle-finders", "Roof pitches and out-of-square rooms."),
            G("best-laser-levels", "Datums across rooms, so floors and cills relate to each other."),
        ]),
    "mvhr-installation-cost": (
        "Before a whole-house ventilation system, find out what the house is doing now. The numbers usually surprise people.",
        [
            G("best-hygrometers", "One per room, for a fortnight."),
            G("best-air-quality-monitors", "CO&#8322; is the honest measure of ventilation; over 1,000ppm overnight means the bedroom isn&rsquo;t getting enough."),
            G("best-anemometers", "Check what the existing extractor fans actually move."),
            G("best-smoke-pens", "Find where the air is really coming in."),
        ]),
    "new-boiler-cost": (
        "The controls around a boiler matter as much as the boiler. Three of them are cheap.",
        [
            A("Tado Smart Thermostat V3+ starter kit", "Tado Smart Thermostat V3+ Starter Kit", "Weather compensation and modulation on a combi is worth more than a bigger boiler."),
            A("Tado Smart Radiator Thermostat starter kit", "Tado Smart Radiator Thermostat Starter Kit", "Heat the rooms you&rsquo;re in."),
            G("best-carbon-monoxide-detectors", "Required alongside the appliance; the &pound;25 one is fine."),
            G("best-hygrometers", "A dry, warm house is what you&rsquo;re buying; measure it."),
        ]),
    "new-roof-cost": (
        "Before a roofer tells you the roof is finished, look at it yourself from three angles.",
        [
            G("best-binoculars-roof-inspections", "Slipped tiles, cracked ridges, failed flashings, from the ground."),
            G("best-drones-roof-inspections", "The whole roof in ten minutes, photographed."),
            G("best-roof-ladders", "If you must go up, a hook ladder is the only safe way onto a pitched roof."),
            A("Telescopic inspection camera pole", "telescopic inspection camera pole", "Flat roofs and box gutters without a ladder."),
        ]),
    "party-wall-surveyor-cost": (
        "A schedule of condition is the document that ends most party wall disputes. You can start your own before the surveyors are appointed.",
        [
            G("best-crack-monitors", "Tell-tales on every existing crack, dated and photographed before next door&rsquo;s works start."),
            G("best-laser-measures", "Floor levels and room dimensions for the schedule."),
            G("best-decibel-meters", "If the dispute is noise, a dated log beats an argument."),
            G("best-dictaphones", "Notes on the day, while it&rsquo;s fresh."),
        ]),
    "repointing-cost": (
        "Repointing a small area yourself is realistic on soft brick with the right mortar. The tools are cheap; the patience isn&rsquo;t.",
        [
            G("best-bolster-chisels", "Rake out by hand, not with a grinder, on old brick."),
            G("best-damp-meters", "Check the wall is dry before and after; cement pointing traps water."),
            G("best-safety-glasses", "Mortar chips travel."),
            G("best-respirator-masks", "Lime and old mortar dust."),
            G("best-work-gloves", "Lime burns."),
        ]),
    "retrofit-assessment-cost": (
        "A PAS 2035 assessment is a fabric-first look at the whole house. This is the instrument set that look depends on.",
        [
            G("best-hygrometers", "Moisture risk starts with the humidity the house already runs at."),
            G("best-thermal-imaging-cameras", "Where the heat goes."),
            G("best-damp-meters", "Moisture is the thing retrofit gets wrong most often."),
            G("best-infrared-thermometers", "Surface temperatures for condensation risk after insulating."),
            G("best-smoke-pens", "Air leakage paths before anyone talks about airtightness."),
        ]),
    "rising-damp-treatment-cost": (
        "Genuine rising damp is rarer than the quotes suggest. Before you treat it, measure it.",
        [
            G("best-damp-meters", "A rising-damp profile is a tide mark that falls with height; map it."),
            G("best-hygrometers", "If the humidity is high, you have condensation, whatever the leaflet says."),
            G("best-dehumidifiers", "The treatment for the more common diagnosis."),
            G("best-moisture-traps", "Cupboards and behind furniture on outside walls."),
            G("best-mould-test-kits", "When the black growth needs a name."),
        ]),
    "sap-calculation-cost": (
        "You can&rsquo;t do the SAP yourself, but you can give the assessor accurate dimensions and save a revision fee.",
        [
            G("best-laser-measures", "Every room, every window, in an afternoon."),
            G("best-digital-angle-finders", "Roof pitch for the loft and room-in-roof calculations."),
            G("best-measuring-wheels", "External wall lengths and the plot."),
        ]),
    "scaffolding-cost": (
        "A lot of two-storey jobs don&rsquo;t need scaffolding at all. These are the alternatives, with the safety kit they need.",
        [
            G("best-scaffold-towers", "A 4m platform tower does gutters, soffits and first-floor windows."),
            G("best-telescopic-ladders", "Short jobs, one person, packs into the boot."),
            G("best-podium-steps", "The safe answer to the wobbly stepladder for anything under 3m."),
            G("best-safety-harnesses", "For the roof work a tower gets you close to."),
            G("best-hard-hats", "Anything falling off a roof lands on the person below it."),
        ]),
    "sellers-survey-cost": (
        "Before you pay for a seller&rsquo;s survey, an hour with this kit finds the things a buyer&rsquo;s surveyor will find in the first ten minutes.",
        [
            G("best-damp-meters", "Ground-floor walls, window reveals, the bathroom wall."),
            G("best-smoke-pens", "Draughts round windows and doors the buyer will feel."),
            G("best-socket-testers", "Faulty sockets go straight into a report."),
            G("best-carbon-monoxide-detectors", "The buyer&rsquo;s surveyor will note their absence."),
            G("best-head-torches", "The loft, before the surveyor sees it."),
        ]),
    "single-storey-extension-cost": (
        "The dimensions decide permitted development, party wall notices and the price per square metre. Get them right yourself first.",
        [
            G("best-laser-measures", "Internal dimensions of what you&rsquo;re joining onto."),
            G("best-measuring-wheels", "The projection from the original rear wall, which is the permitted development limit."),
            G("best-laser-levels", "Ground levels across the footprint; steps in level cost money."),
            G("best-crack-monitors", "On the existing house, near the junction, before work starts."),
        ]),
    "snagging-survey-cost": (
        "A snagging list is mostly patience and a few instruments. Do the first pass yourself before the two-year defects window closes.",
        [
            G("best-spirit-levels", "Walls, floors, cills and door frames; 3mm over 1.2m is the usual tolerance."),
            G("best-laser-measures", "Room sizes against the plans."),
            G("best-socket-testers", "Every socket, every wiring fault."),
            G("best-damp-meters", "New plaster should be dry by now; the window reveals often aren&rsquo;t."),
            G("best-smoke-pens", "Draughts round trickle vents and frames."),
        ]),
    "solar-panels-cost": (
        "The roof and your consumption decide whether solar pays. Both are measurable before the salesman arrives.",
        [
            G("best-drones-roof-inspections", "The roof&rsquo;s condition before you fix twenty-five-year panels to it."),
            G("best-binoculars-roof-inspections", "Cheaper than a drone, and enough to spot a tired roof."),
            A("Tapo P110 energy-monitoring smart plug", "TP-Link Tapo P110", "Measure the appliances that actually drive your daytime load."),
            A("Emporia Vue whole-house energy monitor", "Emporia Vue 3 energy monitor", "Half-hourly consumption data is what a good installer should ask for."),
        ]),
    "structural-engineer-cost": (
        "An engineer will want to know how a crack is behaving over time. You can start that record today.",
        [
            G("best-crack-monitors", "A dated tell-tale across the crack, read monthly."),
            G("best-digital-calipers", "Crack width to a tenth of a millimetre."),
            G("best-spirit-levels", "Floors sloping towards the crack are the key symptom."),
            G("best-laser-levels", "Floor levels across the house, recorded for the file."),
            G("best-plumb-bobs", "Walls out of plumb, measured not guessed."),
        ]),
    "survey-defect-cost": (
        "Some of the scary things in a survey report are cheap to check, and a few are cheap to treat.",
        [
            A("Cuprinol 5 Star Complete Wood Treatment", "Cuprinol 5 Star Complete Wood Treatment", "For woodworm that&rsquo;s actually active, not the historic holes in every Victorian joist."),
            G("best-damp-meters", "Timber over 20% is at risk; below that, the beetle isn&rsquo;t interested."),
            G("best-borescopes", "Under the floor, to see what the surveyor could only guess at."),
            G("best-mould-test-kits", "When the report says &ldquo;mould&rdquo; and you want to know which."),
            A("Roundup Tree Stump &amp; Root Killer", "Roundup Tree Stump and Root Killer", "Knotweed is a multi-season treatment; start now."),
        ]),
    "topographical-survey-cost": (
        "For a garden extension or a level check before drawings, a rough topo is within reach of a careful amateur.",
        [
            G("best-laser-levels", "A line or rotary laser and a staff give you levels across the site."),
            G("best-measuring-wheels", "Boundaries and building lines."),
            G("best-laser-measures", "Offsets to the house and the boundaries."),
            G("best-plumb-bobs", "Transferring points down to the ground, the old way."),
        ]),
    "underfloor-heating-cost": (
        "Underfloor heating only makes sense on a well-insulated, dry floor at a low flow temperature. Check the first two yourself.",
        [
            G("best-infrared-thermometers", "Floor surface temperatures room by room, the first winter."),
            G("best-thermal-imaging-cameras", "Uninsulated slab edges show up as a cold band."),
            G("best-damp-meters", "Screed and timber floors must be dry before you bury heat in them."),
            G("best-hygrometers", "Humidity tells you whether the floor is still drying out."),
            A("Tado Smart Thermostat V3+ starter kit", "Tado Smart Thermostat V3+ Starter Kit", "The weather-compensated control underfloor heating needs to run cool."),
        ]),
    "underpinning-cost": (
        "Most subsidence claims start with a crack and end with a period of monitoring. Start the monitoring yourself.",
        [
            G("best-crack-monitors", "Dated tell-tales are what the insurer&rsquo;s engineer will fit anyway."),
            G("best-spirit-levels", "Which way the floors fall."),
            G("best-plumb-bobs", "Walls leaning with the crack."),
            G("best-laser-levels", "Floor levels across the house, recorded for the file."),
            G("best-digital-calipers", "Crack width, measured the same way each month."),
        ]),
}


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #
def esc_href(href: str) -> str:
    return href.replace("&", "&amp;")


def amazon(search: str) -> str:
    from urllib.parse import quote_plus
    return AMZ.format(k=quote_plus(search))


def render_item(item: dict, guides: dict) -> str:
    if "guide" in item:
        g = guides[item["guide"]]
        name = html.escape(g["name"], quote=False)
        href = esc_href(g["href"])
        price = html.escape(g["price"], quote=False)
        why = item["why"] + f' <a class="kit-guide" href="../{item["guide"]}/">Full guide</a>'
        price_html = f' <span class="kit-price">{price}</span>' if price else ""
    else:
        name = item["name"]
        href = esc_href(amazon(item["search"]))
        why = item["why"]
        price_html = ""
    return (
        "            <li>\n"
        f'              <div class="kit-item"><span class="kit-name">{name}</span>'
        f'<span class="kit-why">{why}{price_html}</span></div>\n'
        f'              <a class="buy" href="{href}" target="_blank" rel="sponsored nofollow noopener">Check price on Amazon</a>\n'
        "            </li>\n"
    )


DISC = ("Amazon affiliate links: if you buy through them the practice earns a small commission at no "
        "extra cost to you. As an Amazon Associate I earn from qualifying purchases. I haven&rsquo;t "
        "lab-tested these products myself; each pick comes from the linked guide, which draws on "
        "manufacturers&rsquo; specifications and published user feedback.")


def render_box(intro: str, items: list, guides: dict) -> str:
    lis = "".join(render_item(i, guides) for i in items)
    return (
        '        <aside class="kit-box" aria-label="Kit for this job">\n'
        '          <p class="kit-label">Kit for this job</p>\n'
        f'          <p class="kit-intro">{intro}</p>\n'
        "          <ul>\n"
        f"{lis}"
        "          </ul>\n"
        f'          <p class="kit-disc">{DISC}</p>\n'
        "        </aside>\n\n"
    )


def main() -> int:
    guides = load_guides()
    missing = sorted({i["guide"] for _, items in MAP.values() for i in items if "guide" in i} - set(guides))
    if missing:
        print("ERROR: mapping references guides that don't exist:", missing)
        return 1

    done = skipped = 0
    for slug, (intro, items) in MAP.items():
        path = os.path.join(JOURNAL, slug, "index.html")
        if not os.path.exists(path):
            print("ERROR: no such cost guide:", slug)
            return 1
        s = open(path, encoding="utf-8").read()
        if 'class="kit-box"' in s:
            skipped += 1
            continue
        hrs = [m.start() for m in re.finditer(r"^\s*<hr\s*/?>\s*$", s, re.M)]
        if len(hrs) != 1:
            print(f"ERROR: {slug} has {len(hrs)} <hr/> lines; expected 1")
            return 1
        s = s[: hrs[0]].rstrip("\n") + "\n\n" + render_box(intro, items, guides) + s[hrs[0]:].lstrip("\n")
        s = re.sub(r"site\.css\?v=\d+", f"site.css?v={CSS_V}", s)
        open(path, "w", encoding="utf-8", newline="\n").write(s)
        done += 1

    # verification pass over every cost guide
    problems = []
    for slug in MAP:
        s = open(os.path.join(JOURNAL, slug, "index.html"), encoding="utf-8").read()
        box = re.search(r'<aside class="kit-box".*?</aside>', s, re.S)
        if not box:
            problems.append(f"{slug}: no kit-box"); continue
        b = box.group(0)
        for href in re.findall(r'href="([^"]+)"', b):
            if href.startswith("https://www.amazon.co.uk/"):
                if "tag=opeconltd-21" not in href or "&amp;amp;" in href or re.search(r"&(?!amp;)", href):
                    problems.append(f"{slug}: bad amazon href {href[:80]}")
            elif href.startswith("../"):
                target = os.path.join(JOURNAL, href[3:].strip("/"), "index.html")
                if not os.path.exists(target):
                    problems.append(f"{slug}: broken internal link {href}")
            else:
                problems.append(f"{slug}: unexpected href {href}")
        n = b.count("<li>")
        if not 3 <= n <= 5:
            problems.append(f"{slug}: {n} items")
        if "As an Amazon Associate" not in b:
            problems.append(f"{slug}: disclosure missing")
    print(f"added {done}, skipped {skipped} (already boxed), verified {len(MAP)} guides")
    for p in problems:
        print("PROBLEM:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
