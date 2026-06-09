import argparse
from pathlib import Path
import sys

from app.graph import ShoppingAssistant


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Student scaffold CLI.")
    parser.add_argument("--question", help="Run one question through the graph.")
    parser.add_argument("--test-file", default="data/test.json")
    parser.add_argument("--trace-file", default=None)
    parser.add_argument("--batch", action="store_true")
    return parser


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    args = build_parser().parse_args()
    assistant = ShoppingAssistant()

    if args.batch:
        test_file_path = Path(args.test_file)
        output_dir = Path("src/artifacts/traces")
        print(f"Running batch test using {test_file_path}...")
        summary = assistant.run_batch(test_file_path, output_dir)
        
        metrics = summary["metrics"]
        print("\n--- BATCH TEST SUMMARY ---")
        print(f"Total:      {metrics['total']}")
        print(f"Passed:     {metrics['passed']}")
        print(f"Failed:     {metrics['failed']}")
        print(f"Pass Rate:  {metrics['pass_rate']:.2%}")
        print(f"Traces written to {output_dir}")
        print("--------------------------")
    elif args.question:
        trace_file_path = Path(args.trace_file) if args.trace_file else None
        print(f"Question: {args.question}")
        res = assistant.ask(args.question, trace_file=trace_file_path)
        print("\n--- FINAL ANSWER ---")
        print(res["final_answer"])
    else:
        print("Please specify either --question or --batch. Use --help for usage details.")


if __name__ == "__main__":
    main()

