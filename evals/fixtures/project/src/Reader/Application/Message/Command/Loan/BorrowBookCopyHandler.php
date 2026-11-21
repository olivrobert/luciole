<?php

declare(strict_types=1);

namespace Reader\Application\Message\Command\Loan;

use Reader\Application\Message\Command\BorrowBookCopy\BorrowBookCopy;
use Reader\Domain\Exception\LoanQuotaReachedException;
use Reader\Domain\Model\Loan;
use Reader\Domain\Repository\LoanRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class BorrowBookCopyHandler
{
    private const int QUOTA = 5;

    public function __construct(
        private LoanRepositoryInterface $loanRepository,
    ) {
    }

    public function __invoke(BorrowBookCopy $command): Loan
    {
        if ($this->loanRepository->countActiveForReader($command->reader) >= self::QUOTA) {
            throw new LoanQuotaReachedException(self::QUOTA);
        }

        $command->bookCopy->borrow();
        $loan = new Loan($command->reader, $command->bookCopy);

        $this->loanRepository->save($loan);

        return $loan;
    }
}
