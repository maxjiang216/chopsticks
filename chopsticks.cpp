#include "chopsticks.hpp"
#include <sqlite3.h>
#include <algorithm>
#include <queue>
#include <set>
#include <map>
#include <stdexcept>
#include <iostream>

namespace chopsticks {

// ============================================================================
// Position Implementation
// ============================================================================

std::vector<Move> Position::legal_moves(const Rules& rules) const {
    std::vector<Move> moves;
    
    if (is_terminal()) {
        return moves;  // No moves from terminal position
    }
    
    // Generate attacks
    // We need to handle the case where lo == hi (both hands same value)
    // to avoid duplicate moves
    std::set<std::pair<int, int>> attack_results;  // (my_hand_value, their_new_value)
    
    for (int my_hand = 0; my_hand < 2; ++my_hand) {
        int my_val = current.fingers[my_hand];
        if (rules.is_dead(my_val)) continue;  // Can't attack with dead hand
        
        for (int their_hand = 0; their_hand < 2; ++their_hand) {
            int their_val = opponent.fingers[their_hand];
            if (!rules.death_attack && rules.is_dead(their_val)) {
                continue;
            }
            
            int new_val = rules.apply_attack(their_val, my_val);
            
            // Check for duplicate (when hands have same value)
            auto key = std::make_pair(my_val, new_val);
            if (attack_results.count(key)) continue;
            attack_results.insert(key);
            
            moves.push_back(Move::make_attack(my_hand, their_hand));
        }
    }
    
    // Generate splits
    int total = current.total();
    if (total > 0) {  // Can only split if we have points
        std::set<std::pair<int, int>> seen_splits;
        seen_splits.insert({current.lo(), current.hi()});  // Current config not allowed
        
        for (int new_lo = 0; new_lo < rules.max_fingers; ++new_lo) {
            int new_hi = total - new_lo;
            
            // Validate
            if (new_hi < new_lo) continue;  // Ensure normalized
            if (!rules.is_valid_hand(new_hi)) continue;  // new_hi must be valid
            if (new_lo == 0 && new_hi == 0) continue;  // Can't kill yourself
            
            auto config = std::make_pair(new_lo, new_hi);
            if (seen_splits.count(config)) continue;  // Must be different
            seen_splits.insert(config);
            
            moves.push_back(Move::make_split(new_lo, new_hi));
        }
    }
    
    return moves;
}

Position Position::apply_move(const Move& move, const Rules& rules) const {
    Hands new_current = current;
    Hands new_opponent = opponent;
    
    if (move.type == MoveType::ATTACK) {
        int my_val = current.fingers[move.attack.my_hand];
        int their_val = opponent.fingers[move.attack.their_hand];
        int new_val = rules.apply_attack(their_val, my_val);
        
        // Modify opponent's hand and re-normalize
        std::array<int, 2> opp_fingers = {opponent.fingers[0], opponent.fingers[1]};
        opp_fingers[move.attack.their_hand] = new_val;
        new_opponent = Hands(opp_fingers[0], opp_fingers[1]);
        
    } else {  // SPLIT
        new_current = Hands(move.split.new_lo, move.split.new_hi);
    }
    
    // Swap sides for next turn
    return Position(new_opponent, new_current);
}

// ============================================================================
// Solver Implementation
// ============================================================================

Solver::Solver(const Rules& rules) : rules_(rules) {
    solutions_.resize(Position::count(rules_));
}

void Solver::solve() {
    if (solved_) return;
    
    initialize_terminals();
    propagate();
    classify_draws();
    compute_best_moves();
    
    solved_ = true;
}

void Solver::initialize_terminals() {
    // Terminal positions: current player has (0,0) - they've lost
    int num_positions = Position::count(rules_);
    
    for (int i = 0; i < num_positions; ++i) {
        Position pos = Position::from_index(i, rules_);
        
        if (pos.current.is_dead()) {
            // This is a losing position (you've already lost)
            solutions_[i].result = Result::LOSS;
            solutions_[i].depth = 0;
        }
    }
}

void Solver::propagate() {
    // Use a worklist algorithm
    // A position is WIN if any successor is LOSS
    // A position is LOSS if ALL successors are WIN
    
    bool changed = true;
    int iterations = 0;
    const int max_iterations = 1000;  // Safety limit
    
    while (changed && iterations < max_iterations) {
        changed = false;
        ++iterations;
        
        int num_positions = Position::count(rules_);
        
        for (int i = 0; i < num_positions; ++i) {
            if (solutions_[i].result != Result::UNKNOWN) continue;
            
            Position pos = Position::from_index(i, rules_);
            std::vector<Move> moves = pos.legal_moves(rules_);
            
            if (moves.empty()) continue;  // Shouldn't happen for non-terminal
            
            int loss_count = 0;
            int win_count = 0;
            int unknown_count = 0;
            int min_loss_depth = INT32_MAX;
            int max_win_depth = -1;
            
            for (const Move& move : moves) {
                Position next = pos.apply_move(move, rules_);
                int next_idx = next.index(rules_);
                const PositionSolution& next_sol = solutions_[next_idx];
                
                switch (next_sol.result) {
                    case Result::WIN:
                        ++win_count;
                        max_win_depth = std::max(max_win_depth, next_sol.depth);
                        break;
                    case Result::LOSS:
                        ++loss_count;
                        min_loss_depth = std::min(min_loss_depth, next_sol.depth);
                        break;
                    case Result::DRAW:
                        // Treat as "not a win for us, not a loss for us"
                        break;
                    case Result::UNKNOWN:
                        ++unknown_count;
                        break;
                }
            }
            
            // If any move leads to opponent's LOSS, we WIN
            if (loss_count > 0) {
                solutions_[i].result = Result::WIN;
                solutions_[i].depth = min_loss_depth + 1;
                changed = true;
            }
            // If ALL moves lead to opponent's WIN (no unknowns, no draws, no losses), we LOSE
            else if (unknown_count == 0 && loss_count == 0 && win_count == static_cast<int>(moves.size())) {
                solutions_[i].result = Result::LOSS;
                solutions_[i].depth = max_win_depth + 1;
                changed = true;
            }
        }
    }
}

void Solver::classify_draws() {
    // All remaining UNKNOWN positions are DRAWS (can cycle forever)
    int num_positions = Position::count(rules_);
    
    for (int i = 0; i < num_positions; ++i) {
        if (solutions_[i].result == Result::UNKNOWN) {
            solutions_[i].result = Result::DRAW;
            solutions_[i].depth = -1;  // Infinite
        }
    }
}

void Solver::compute_best_moves() {
    int num_positions = Position::count(rules_);
    
    for (int i = 0; i < num_positions; ++i) {
        Position pos = Position::from_index(i, rules_);
        std::vector<Move> moves = pos.legal_moves(rules_);
        
        if (moves.empty()) continue;
        
        PositionSolution& sol = solutions_[i];
        
        switch (sol.result) {
            case Result::WIN: {
                // Find all moves that lead to opponent LOSS with minimum depth
                int target_depth = sol.depth - 1;
                for (const Move& move : moves) {
                    Position next = pos.apply_move(move, rules_);
                    const PositionSolution& next_sol = get_solution(next);
                    if (next_sol.result == Result::LOSS && next_sol.depth == target_depth) {
                        sol.best_moves.push_back(move);
                    }
                }
                break;
            }
            
            case Result::LOSS: {
                // Find move(s) that lead to opponent WIN with maximum depth (longest survival)
                int max_depth = -1;
                for (const Move& move : moves) {
                    Position next = pos.apply_move(move, rules_);
                    const PositionSolution& next_sol = get_solution(next);
                    if (next_sol.result == Result::WIN) {
                        max_depth = std::max(max_depth, next_sol.depth);
                    }
                }
                for (const Move& move : moves) {
                    Position next = pos.apply_move(move, rules_);
                    const PositionSolution& next_sol = get_solution(next);
                    if (next_sol.result == Result::WIN && next_sol.depth == max_depth) {
                        sol.best_moves.push_back(move);
                    }
                }
                break;
            }
            
            case Result::DRAW: {
                // Find all moves that lead to DRAW or opponent LOSS
                for (const Move& move : moves) {
                    Position next = pos.apply_move(move, rules_);
                    const PositionSolution& next_sol = get_solution(next);
                    if (next_sol.result == Result::DRAW || next_sol.result == Result::LOSS) {
                        sol.best_moves.push_back(move);
                    }
                }
                break;
            }
            
            default:
                break;
        }
    }
}

const PositionSolution& Solver::get_solution(const Position& pos) const {
    return solutions_[pos.index(rules_)];
}

const PositionSolution& Solver::get_solution(int pos_index) const {
    return solutions_[pos_index];
}

int Solver::count_wins() const {
    return std::count_if(solutions_.begin(), solutions_.end(),
        [](const PositionSolution& s) { return s.result == Result::WIN; });
}

int Solver::count_losses() const {
    return std::count_if(solutions_.begin(), solutions_.end(),
        [](const PositionSolution& s) { return s.result == Result::LOSS; });
}

int Solver::count_draws() const {
    return std::count_if(solutions_.begin(), solutions_.end(),
        [](const PositionSolution& s) { return s.result == Result::DRAW; });
}

// ============================================================================
// SQLite Export
// ============================================================================

void Solver::export_to_sqlite(const std::string& filename) const {
    sqlite3* db;
    int rc = sqlite3_open(filename.c_str(), &db);
    if (rc) {
        throw std::runtime_error("Cannot open database: " + std::string(sqlite3_errmsg(db)));
    }
    
    char* err_msg = nullptr;
    
    // Create tables
    const char* create_sql = R"(
        DROP TABLE IF EXISTS rules;
        DROP TABLE IF EXISTS positions;
        DROP TABLE IF EXISTS moves;
        DROP TABLE IF EXISTS best_moves;
        DROP TABLE IF EXISTS graph_edges;
        
        CREATE TABLE rules (
            id INTEGER PRIMARY KEY,
            max_fingers INTEGER,
            rollover INTEGER,
            death_attack INTEGER
        );
        
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY,
            current_lo INTEGER,
            current_hi INTEGER,
            opponent_lo INTEGER,
            opponent_hi INTEGER,
            result TEXT,
            depth INTEGER,
            position_str TEXT
        );
        
        CREATE TABLE moves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            move_type TEXT,
            -- For attacks
            my_hand INTEGER,
            their_hand INTEGER,
            -- For splits
            new_lo INTEGER,
            new_hi INTEGER,
            move_str TEXT
        );
        
        CREATE TABLE best_moves (
            position_id INTEGER,
            move_id INTEGER,
            FOREIGN KEY (position_id) REFERENCES positions(id),
            FOREIGN KEY (move_id) REFERENCES moves(id)
        );
        
        CREATE TABLE graph_edges (
            from_position_id INTEGER,
            to_position_id INTEGER,
            move_id INTEGER,
            FOREIGN KEY (from_position_id) REFERENCES positions(id),
            FOREIGN KEY (to_position_id) REFERENCES positions(id),
            FOREIGN KEY (move_id) REFERENCES moves(id)
        );
        
        CREATE INDEX idx_best_moves_pos ON best_moves(position_id);
        CREATE INDEX idx_graph_from ON graph_edges(from_position_id);
        CREATE INDEX idx_graph_to ON graph_edges(to_position_id);
    )";
    
    rc = sqlite3_exec(db, create_sql, nullptr, nullptr, &err_msg);
    if (rc != SQLITE_OK) {
        std::string msg = err_msg;
        sqlite3_free(err_msg);
        sqlite3_close(db);
        throw std::runtime_error("SQL error: " + msg);
    }
    
    // Begin transaction for speed
    sqlite3_exec(db, "BEGIN TRANSACTION", nullptr, nullptr, nullptr);
    
    // Insert rules
    sqlite3_stmt* stmt;
    sqlite3_prepare_v2(db, "INSERT INTO rules VALUES (1, ?, ?, ?)", -1, &stmt, nullptr);
    sqlite3_bind_int(stmt, 1, rules_.max_fingers);
    sqlite3_bind_int(stmt, 2, rules_.rollover ? 1 : 0);
    sqlite3_bind_int(stmt, 3, rules_.death_attack ? 1 : 0);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    
    // Build move table (deduplicated)
    std::map<std::string, int> move_to_id;
    int move_id = 1;
    
    sqlite3_prepare_v2(db, 
        "INSERT INTO moves (id, move_type, my_hand, their_hand, new_lo, new_hi, move_str) VALUES (?, ?, ?, ?, ?, ?, ?)",
        -1, &stmt, nullptr);
    
    // First pass: collect all unique moves
    int num_positions = Position::count(rules_);
    for (int i = 0; i < num_positions; ++i) {
        Position pos = Position::from_index(i, rules_);
        for (const Move& move : pos.legal_moves(rules_)) {
            std::string move_str = move.to_string();
            if (move_to_id.find(move_str) == move_to_id.end()) {
                move_to_id[move_str] = move_id;
                
                sqlite3_reset(stmt);
                sqlite3_bind_int(stmt, 1, move_id);
                sqlite3_bind_text(stmt, 2, move.type == MoveType::ATTACK ? "ATTACK" : "SPLIT", -1, SQLITE_STATIC);
                if (move.type == MoveType::ATTACK) {
                    sqlite3_bind_int(stmt, 3, move.attack.my_hand);
                    sqlite3_bind_int(stmt, 4, move.attack.their_hand);
                    sqlite3_bind_null(stmt, 5);
                    sqlite3_bind_null(stmt, 6);
                } else {
                    sqlite3_bind_null(stmt, 3);
                    sqlite3_bind_null(stmt, 4);
                    sqlite3_bind_int(stmt, 5, move.split.new_lo);
                    sqlite3_bind_int(stmt, 6, move.split.new_hi);
                }
                sqlite3_bind_text(stmt, 7, move_str.c_str(), -1, SQLITE_TRANSIENT);
                sqlite3_step(stmt);
                
                ++move_id;
            }
        }
    }
    sqlite3_finalize(stmt);
    
    // Insert positions
    sqlite3_prepare_v2(db, 
        "INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        -1, &stmt, nullptr);
    
    for (int i = 0; i < num_positions; ++i) {
        Position pos = Position::from_index(i, rules_);
        const PositionSolution& sol = solutions_[i];
        
        sqlite3_reset(stmt);
        sqlite3_bind_int(stmt, 1, i);
        sqlite3_bind_int(stmt, 2, pos.current.lo());
        sqlite3_bind_int(stmt, 3, pos.current.hi());
        sqlite3_bind_int(stmt, 4, pos.opponent.lo());
        sqlite3_bind_int(stmt, 5, pos.opponent.hi());
        sqlite3_bind_text(stmt, 6, result_to_string(sol.result).c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 7, sol.depth);
        sqlite3_bind_text(stmt, 8, pos.to_string().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
    }
    sqlite3_finalize(stmt);
    
    // Insert best moves
    sqlite3_prepare_v2(db, "INSERT INTO best_moves VALUES (?, ?)", -1, &stmt, nullptr);
    
    for (int i = 0; i < num_positions; ++i) {
        const PositionSolution& sol = solutions_[i];
        for (const Move& move : sol.best_moves) {
            int mid = move_to_id[move.to_string()];
            sqlite3_reset(stmt);
            sqlite3_bind_int(stmt, 1, i);
            sqlite3_bind_int(stmt, 2, mid);
            sqlite3_step(stmt);
        }
    }
    sqlite3_finalize(stmt);
    
    // Insert graph edges
    sqlite3_prepare_v2(db, "INSERT INTO graph_edges VALUES (?, ?, ?)", -1, &stmt, nullptr);
    
    for (int i = 0; i < num_positions; ++i) {
        Position pos = Position::from_index(i, rules_);
        for (const Move& move : pos.legal_moves(rules_)) {
            Position next = pos.apply_move(move, rules_);
            int next_idx = next.index(rules_);
            int mid = move_to_id[move.to_string()];
            
            sqlite3_reset(stmt);
            sqlite3_bind_int(stmt, 1, i);
            sqlite3_bind_int(stmt, 2, next_idx);
            sqlite3_bind_int(stmt, 3, mid);
            sqlite3_step(stmt);
        }
    }
    sqlite3_finalize(stmt);
    
    // Commit transaction
    sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr);
    sqlite3_close(db);
}

// ============================================================================
// Reachability (full graph: both players any legal move)
// ============================================================================

int count_reachable_states(const Rules& rules) {
    const int n = Position::count(rules);
    std::vector<std::uint8_t> vis(n, 0);
    std::queue<int> q;
    const Position start = Position::initial();
    const int start_i = start.index(rules);
    vis[start_i] = 1;
    q.push(start_i);
    while (!q.empty()) {
        const int i = q.front();
        q.pop();
        const Position pos = Position::from_index(i, rules);
        if (pos.is_terminal()) {
            continue;
        }
        for (const Move& m : pos.legal_moves(rules)) {
            const int nxt = pos.apply_move(m, rules).index(rules);
            if (vis[nxt] == 0) {
                vis[nxt] = 1;
                q.push(nxt);
            }
        }
    }
    int c = 0;
    for (int i = 0; i < n; ++i) {
        c += static_cast<int>(vis[i]);
    }
    return c;
}

} // namespace chopsticks
