#include "chopsticks.hpp"
#include <cstdio>
#include <iomanip>
#include <iostream>
#include <optional>
#include <string>

using namespace chopsticks;

void print_solution_table(const Solver& solver) {
    const Rules& rules = solver.rules();
    int num_positions = Position::count(rules);

    std::cout << "\n=== SOLUTION TABLE ===\n\n";
    std::cout << std::left << std::setw(25) << "Position"
              << std::setw(10) << "Result"
              << std::setw(8) << "Depth"
              << "Best Moves\n";
    std::cout << std::string(80, '-') << "\n";

    for (int i = 0; i < num_positions; ++i) {
        Position pos = Position::from_index(i, rules);
        const PositionSolution& sol = solver.get_solution(i);

        if (pos.current.is_dead() && pos.opponent.is_dead()) {
            continue;
        }

        std::cout << std::left << std::setw(25) << pos.to_string()
                  << std::setw(10) << result_to_string(sol.result);

        if (sol.depth >= 0) {
            std::cout << std::setw(8) << sol.depth;
        } else {
            std::cout << std::setw(8) << "inf";
        }

        for (size_t j = 0; j < sol.best_moves.size(); ++j) {
            if (j > 0) {
                std::cout << ", ";
            }
            std::cout << sol.best_moves[j].to_string();
        }
        std::cout << "\n";
    }
}

void print_statistics(const Solver& solver) {
    std::cout << "\n=== STATISTICS (all abstract positions) ===\n";
    std::cout << "Total positions: " << solver.total_positions() << "\n";
    std::cout << "Winning: " << solver.count_wins() << "\n";
    std::cout << "Losing:  " << solver.count_losses() << "\n";
    std::cout << "Draw:    " << solver.count_draws() << "\n";
}

void print_reachability(const Rules& rules) {
    const int n = count_reachable_states(rules);
    const int total = Position::count(rules);
    std::cout << "\n=== REACHABILITY (from (1,1) vs (1,1), any legal play) ===\n";
    std::cout << "Reachable position indices: " << n << " / " << total << "\n";
}

void interactive_query(const Solver& solver) {
    std::cout << "\n=== INTERACTIVE ===\n";
    std::cout << "Line: me_lo me_hi opp_lo opp_hi  (e.g. 1 1 1 1)  or q to quit\n";

    std::string line;
    while (true) {
        std::cout << "> ";
        if (!std::getline(std::cin, line)) {
            break;
        }
        if (line == "q" || line == "quit") {
            break;
        }
        int c_lo = 0, c_hi = 0, o_lo = 0, o_hi = 0;
        if (std::sscanf(line.c_str(), "%d %d %d %d", &c_lo, &c_hi, &o_lo, &o_hi) != 4) {
            std::cout << "Need 4 integers.\n";
            continue;
        }
        const Position pos(Hands(c_lo, c_hi), Hands(o_lo, o_hi));
        const PositionSolution& sol = solver.get_solution(pos);
        std::cout << pos.to_string() << " -> " << sol.to_string() << "\n";
    }
}

void analyze_initial_position(const Solver& solver) {
    Position initial = Position::initial();
    const PositionSolution& sol = solver.get_solution(initial);

    std::cout << "\n=== STARTING POSITION (first player to move) ===\n";
    std::cout << "State: " << initial.to_string() << "\n";
    std::cout << "Result for the player to move: " << result_to_string(sol.result) << "\n";

    if (sol.depth >= 0) {
        std::cout << "Depth: " << sol.depth << " plies to terminal (this line)\n";
    }
}

int main(int argc, char* argv[]) {
    // `rollover` and `death_attack` are independent; any of four (false,false)…(true,true) combinations
    // is valid. later flag wins if both on and off are given.
    std::optional<bool> rollover;
    std::optional<bool> death_attack;
    bool interactive = false;
    bool show_table = false;
    bool no_db = false;
    std::string db_file = "chopsticks.db";

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--rollover") {
            rollover = true;
        } else if (arg == "--no-rollover") {
            rollover = false;
        } else if (arg == "--death-attack") {
            death_attack = true;
        } else if (arg == "--no-death-attack") {
            death_attack = false;
        } else if (arg == "--interactive" || arg == "-i") {
            interactive = true;
        } else if (arg == "--table" || arg == "-t") {
            show_table = true;
        } else if (arg == "--no-db") {
            no_db = true;
        } else if (arg == "--db" && i + 1 < argc) {
            db_file = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: " << argv[0] << " [options]\n";
            std::cout << "Rules: rollover and death-attack are independent. Four base modes (defaults all off):\n";
            std::cout << "  (rollover, death_attack)  |  flags\n";
            std::cout << "  (no,    no)   [default]  |  (no flags)\n";
            std::cout << "  (no,   yes)              |  --death-attack\n";
            std::cout << "  (yes,  no)               |  --rollover\n";
            std::cout << "  (yes,  yes)              |  --rollover --death-attack\n";
            std::cout << "  --rollover / --no-rollover  Sum >= max wraps with mod, else 0 (when off)\n";
            std::cout << "  --death-attack / --no-death-attack  May attack opponent 0-finger hands\n";
            std::cout << "Other:\n";
            std::cout << "  --interactive, -i     Query positions on stdin\n";
            std::cout << "  --table, -t          Print full solution table\n";
            std::cout << "  --no-db              Do not write SQLite file\n";
            std::cout << "  --db <file>          Database path (default: chopsticks.db)\n";
            std::cout << "  -h, --help\n";
            return 0;
        }
    }

    const bool use_rollover = rollover.value_or(false);
    const bool use_death_attack = death_attack.value_or(false);
    Rules rules{5, use_rollover, use_death_attack};

    std::cout << "Chopsticks solver\n";
    std::cout << "Rules: max_fingers=" << rules.max_fingers
              << ", rollover=" << (rules.rollover ? "yes" : "no")
              << ", death_attack=" << (rules.death_attack ? "yes" : "no")
              << "\n";

    print_reachability(rules);

    Solver solver(rules);
    std::cout << "Solving all positions...\n";
    solver.solve();
    std::cout << "Done.\n";

    print_statistics(solver);
    analyze_initial_position(solver);

    if (show_table) {
        print_solution_table(solver);
    }

    if (!no_db) {
        std::cout << "\nExporting to " << db_file << "...\n";
        solver.export_to_sqlite(db_file);
        std::cout << "Done.\n";
    }

    if (interactive) {
        interactive_query(solver);
    }

    return 0;
}
