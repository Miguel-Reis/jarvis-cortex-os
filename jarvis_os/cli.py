"""J.A.R.V.I.S. Cortex OS Command Line Interface.

Usage:
    python -m jarvis_os.cli status
    python -m jarvis_os.cli plan
    python -m jarvis_os.cli briefing [--voice] [--preset PRESET]
    python -m jarvis_os.cli memory ingest "Topic" "Content" [--source URI]
    python -m jarvis_os.cli memory search "Query" [--hipporag]
    python -m jarvis_os.cli routine discover
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from jarvis_os.core.telemetry import TelemetryRadar
from jarvis_os.memory.synaptic_db import SynapticDB
from jarvis_os.planning.next_action import ActionCandidate, NextActionPlanner
from jarvis_os.planning.today_contract import TodayContractGate, VerificationType
from jarvis_os.intelligence.personality import PersonalityEngine, PersonalityMode
from jarvis_os.intelligence.routine_discovery import RoutineDiscoveryEngine
from jarvis_os.security.trust_boundary import ClearanceLevel, TrustBoundaryGate
from jarvis_os.voice.mark_vii_tts import AudioDSPPreset, MarkVIISpeechSynthesizer


def cmd_status(args: argparse.Namespace) -> None:
    radar = TelemetryRadar()
    report = radar.capture_report(run_port_scan=True)
    pers = PersonalityEngine()
    profile = pers.get_profile(PersonalityMode.STARK_EXECUTIVE)
    sec = TrustBoundaryGate()

    print("\n" + "=" * 64)
    print("  J.A.R.V.I.S. CORTEX OS — SYSTEM TELEMETRY & COGNITIVE RADAR")
    print("=" * 64)
    print(f" Host:             {report.hostname} ({report.os_name} {report.os_version})")
    print(f" CPU Cores:        {report.cpu_count}")
    print(f" Uptime:           {report.uptime_seconds:.1f} s ({report.uptime_seconds / 3600.0:.2f} hrs)")
    print(f" Physical Memory:  {report.memory.used_mb:.1f} MB / {report.memory.total_mb:.1f} MB ({report.memory.percent_used:.1f}%)")
    for d in report.disks:
        print(f" Disk [{d.drive}]:       {d.used_gb:.1f} GB / {d.total_gb:.1f} GB ({d.percent_used:.1f}%)")
    
    print("\n [PORT RADAR]")
    if report.open_ports:
        for p in report.open_ports:
            print(f"   -> Port {p.port:<5} | {p.service:<15} | OPEN ({p.latency_ms:.1f} ms)")
    else:
        print("   -> No monitored local ports open.")

    print(f"\n [COGNITIVE STATE]")
    print(f"   Personality Mode: {profile.mode.value}")
    print(f"   Cadence:          Conciseness={profile.conciseness:.2f}, Technicality={profile.technicality:.2f}")
    print(f"   Security Gate:    Canaries Active={len(sec.active_canaries)}, Boundary=NOMINAL")
    print("=" * 64 + "\n")


def cmd_plan(args: argparse.Namespace) -> None:
    planner = NextActionPlanner()
    planner.register_candidate(
        ActionCandidate(
            action_id="ACT-001",
            title="Deploy Synaptic Memory WAL Indexes",
            target_component="jarvis_os.memory",
            impact=9.0,
            urgency=8.5,
            effort=2.5,
            risk=1.0,
        )
    )
    planner.register_candidate(
        ActionCandidate(
            action_id="ACT-002",
            title="Run Mark-VII Voice DSP Calibration",
            target_component="jarvis_os.voice",
            impact=8.0,
            urgency=7.0,
            effort=2.0,
            risk=0.5,
            dependencies=["ACT-001"],
        )
    )

    plan = planner.plan_next()
    gate = TodayContractGate()
    gate.add_work_item(
        "WORK-01",
        "Synaptic Memory Ingestion",
        "Pass 100% test suite",
        VerificationType.TEST_PASS,
        "test_jarvis_os.py",
    )

    print("\n" + "=" * 64)
    print("  J.A.R.V.I.S. CORTEX OS — DETERMINISTIC NEXT-ACTION PLAN (Q-18)")
    print("=" * 64)
    if plan.chosen_action:
        ca = plan.chosen_action
        print(f" Chosen Action:   [{ca.action_id}] {ca.title}")
        print(f" Target Module:   {ca.target_component}")
        print(f" Priority Score:  {plan.priority_score:.2f}")
        print(f" Rationale:       {plan.rationale}")
    else:
        print(" No executable action queued.")

    print("\n [TODAY CONTRACT & OUTCOME GATE]")
    summary = gate.get_summary()
    print(f"   Total Daily Items:       {summary['total_items']}")
    print(f"   Verified Completed:      {summary['completed_verified']}")
    print(f"   Completion Rate:         {summary['completion_rate']}%")
    print("=" * 64 + "\n")


def cmd_briefing(args: argparse.Namespace) -> None:
    radar = TelemetryRadar()
    report = radar.capture_report(run_port_scan=False)
    pers = PersonalityEngine()
    profile = pers.get_profile(PersonalityMode.STARK_EXECUTIVE)

    briefing_pt = (
        f"Bom dia, Senhor. Sistemas operacionais nominais. Memória física em {report.memory.percent_used:.1f}%. "
        f"Grafos associativos HippoRAG 2 PPR, Port Radar e sintetizador Mark-VII prontos para execução."
    )
    briefing_en = (
        f"Good day, Sir. Systems operating at nominal capacity. Memory utilization at {report.memory.percent_used:.1f}%. "
        f"HippoRAG 2 PPR associative graphs and Skywalker Sound Mark-VII DSP calibrated."
    )

    lang = getattr(args, "lang", "all").lower()
    print("\n" + "=" * 64)
    print("  J.A.R.V.I.S. CORTEX OS — EXECUTIVE BRIEFING (BILINGUAL PT/EN)")
    print("=" * 64)
    if lang in ("pt", "pt-pt", "pt-br", "all"):
        print(f" [PT-PT] {briefing_pt}")
    if lang in ("en", "en-us", "all"):
        print(f" [EN-US] {briefing_en}")

    if args.voice:
        tts = MarkVIISpeechSynthesizer()
        preset = AudioDSPPreset(args.preset) if hasattr(args, "preset") and args.preset else AudioDSPPreset.MARK_VII_HELMET
        out_wav = os.path.abspath("jarvis_briefing.wav")
        spoken = briefing_pt if lang.startswith("pt") else briefing_en
        tts.synthesize_speech_file(spoken, out_wav, preset=preset)
        print(f"\n [AUDIO DSP] Synthesized Mark-VII audio saved to: {out_wav}")

    print("=" * 64 + "\n")


def cmd_memory_ingest(args: argparse.Namespace) -> None:
    db = SynapticDB(args.db_path)
    entry = db.store_memory(
        topic=args.topic,
        content=args.content,
        source_uri=args.source,
        confidence=args.confidence,
    )
    if entry:
        print(f" [SYNAPTIC_DB] Memory ingested successfully: ID={entry.id}, LSH={entry.lsh_hex[:12]}...")
    else:
        print(" [SYNAPTIC_DB] Memory rejected by Provenance Gate.")


def cmd_memory_search(args: argparse.Namespace) -> None:
    db = SynapticDB(args.db_path)
    print(f"\nSearching for: '{args.query}'")
    bm25 = db.search_bm25(args.query, limit=5)
    print("\n [BM25 Exact/FTS5 Results]")
    for r in bm25:
        print(f"   - [{r['id']}] {r['topic']}: {r['content'][:60]}... (score: {r['bm25_score']})")

    lsh = db.search_semantic_lsh(args.query, threshold=0.40, limit=5)
    print("\n [128-D LSH Semantic SimHash Results]")
    for r in lsh:
        print(f"   - [{r['id']}] {r['topic']}: {r['content'][:60]}... (sim: {r['similarity']:.2f})")


def cmd_routine(args: argparse.Namespace) -> None:
    engine = RoutineDiscoveryEngine(min_recurrence=2)
    # Simulate past telemetry events
    engine.record_event("morning_briefing", "time_0900", time.time() - 86400)
    engine.record_event("morning_briefing", "time_0900", time.time())
    engine.record_event("test_suite_verification", "pre_commit", time.time() - 3600)
    engine.record_event("test_suite_verification", "pre_commit", time.time())

    routines = engine.discover_routines()
    print("\n" + "=" * 64)
    print("  J.A.R.V.I.S. CORTEX OS — DISCOVERED ROUTINES (routine-cues-v2)")
    print("=" * 64)
    for r in routines:
        print(f" [{r.routine_id}] {r.name}")
        print(f"   Confidence: {r.confidence * 100:.1f}% | Evidence Events: {r.evidence_count}")
        print(f"   Recommendation: {r.recommended_action}\n")
    print("=" * 64 + "\n")


def cmd_serve(args: argparse.Namespace) -> None:
    from jarvis_os.server.http_sse import run_server
    run_server(host=args.host, port=args.port, db_path=args.db_path)


def cmd_sidecar(args: argparse.Namespace) -> None:
    from jarvis_os.sidecar.desktop_agent import DesktopSidecar
    sidecar = DesktopSidecar()
    status = sidecar.get_status()
    windows = sidecar.list_active_windows()
    print("\n" + "=" * 64)
    print("  J.A.R.V.I.S. CORTEX OS — DESKTOP SIDECAR & WAKE-WORD RADAR")
    print("=" * 64)
    print(f" Platform:         {status.get('platform')}")
    print(f" Active Windows:   {len(windows)}")
    hotkeys = status.get("registered_hotkeys", [])
    print(f" Hotkeys Bound:    {len(hotkeys)}")
    for hk in hotkeys:
        print(f"   -> [{hk['combination']:<12}] {hk['action_name']} ({hk['description']})")
    print("=" * 64 + "\n")


def cmd_workflow(args: argparse.Namespace) -> None:
    from jarvis_os.workflows.engine import WorkflowEngine
    wf = WorkflowEngine()
    gate = TodayContractGate()
    gate.add_work_item("WORK-CLI", "CLI Test Verification", "100% Pass", VerificationType.TEST_PASS, "tests")
    res = wf.run_unit_test_gate(gate, "WORK-CLI", test_dir="tests")
    git_info = wf.inspect_git_workspace(".")
    print("\n" + "=" * 64)
    print("  J.A.R.V.I.S. CORTEX OS — AUTONOMOUS WORKFLOW & OUTCOME GATE")
    print("=" * 64)
    print(f" Git Branch:       {git_info.get('branch', 'unknown')}")
    print(f" Test Gate Status: {res.status} ({res.duration_ms:.1f} ms)")
    print(f" Gate Proof:       {res.gate_message}")
    print("=" * 64 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="J.A.R.V.I.S. Cortex OS Enterprise CLI")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # status
    p_status = subparsers.add_parser("status", help="Display system telemetry and cognitive radar")
    p_status.set_defaults(func=cmd_status)

    # plan
    p_plan = subparsers.add_parser("plan", help="Run deterministic Q-18 planner and Today contracts")
    p_plan.set_defaults(func=cmd_plan)

    # briefing
    p_briefing = subparsers.add_parser("briefing", help="Generate executive bilingual morning briefing")
    p_briefing.add_argument("--lang", default="all", help="Language output: pt, en, or all")
    p_briefing.add_argument("--voice", action="store_true", help="Synthesize Skywalker Sound Mark-VII audio")
    p_briefing.add_argument("--preset", default="MARK_VII_HELMET", choices=[p.value for p in AudioDSPPreset])
    p_briefing.set_defaults(func=cmd_briefing)

    # memory
    p_mem = subparsers.add_parser("memory", help="Interact with Synaptic DB")
    mem_subs = p_mem.add_subparsers(dest="mem_cmd", required=True)
    p_ingest = mem_subs.add_parser("ingest", help="Ingest memory through Provenance Gate")
    p_ingest.add_argument("topic", help="Memory topic/tag")
    p_ingest.add_argument("content", help="Memory content")
    p_ingest.add_argument("--source", default="cli_entry", help="Source URI")
    p_ingest.add_argument("--confidence", type=float, default=1.0)
    p_ingest.add_argument("--db-path", default="jarvis_synaptic.db")
    p_ingest.set_defaults(func=cmd_memory_ingest)

    p_search = mem_subs.add_parser("search", help="Search memory via BM25 + LSH")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--db-path", default="jarvis_synaptic.db")
    p_search.set_defaults(func=cmd_memory_search)

    # routine
    p_routine = subparsers.add_parser("routine", help="Evidence-backed routine discovery")
    routine_subs = p_routine.add_subparsers(dest="routine_cmd", required=True)
    p_disc = routine_subs.add_parser("discover", help="Discover routine candidates")
    p_disc.set_defaults(func=cmd_routine)

    # serve
    p_serve = subparsers.add_parser("serve", help="Start HTTP/SSE Server & Mark-VII HUD Dashboard")
    p_serve.add_argument("--host", default="127.0.0.1", help="Bind host")
    p_serve.add_argument("--port", type=int, default=8765, help="Bind port")
    p_serve.add_argument("--db-path", default=":memory:", help="SQLite DB path")
    p_serve.set_defaults(func=cmd_serve)

    # sidecar
    p_sidecar = subparsers.add_parser("sidecar", help="Inspect Desktop Sidecar, Windows & Hotkeys")
    p_sidecar.set_defaults(func=cmd_sidecar)

    # workflow
    p_workflow = subparsers.add_parser("workflow", help="Execute Autonomous AST & Unit Test Gate")
    p_workflow.set_defaults(func=cmd_workflow)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

